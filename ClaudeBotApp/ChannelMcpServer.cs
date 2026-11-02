using System.ComponentModel;
using System.Net;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using ModelContextProtocol.Server;

namespace ClaudeBotApp;

/// <summary>
/// A bot-csatorna MCP szervere (ADR-0005). Ez a feature kulcs-darabja: a `claude.exe`-ből a hoszt
/// felé az EGYETLEN tiszta, kétirányú út a tool-hívás, ezért a publikálást egy MCP szerver tool-jai
/// valósítják meg. A szerver a hoszt folyamatán belül, Kestrelen, kizárólag a loopback interfészen
/// hallgat, dinamikus porton.
///
/// A hívó bot kiléte az URL-ben lévő, kitalálhatatlan tokenből derül ki — NEM a tool paraméteréből.
/// Így egy bot nem adhatja ki magát másnak, és egy idegen helyi folyamat sem tud a csatornára írni.
/// </summary>
public sealed class ChannelMcpServer
{
    private const string PathPrefix = "/mcp/";

    private readonly ChannelBackend _backend = new();
    private WebApplication? _app;

    /// <summary>A szerver gyökér-címe (pl. `http://127.0.0.1:51234`), vagy null, ha nem indult el.
    /// A <see cref="BotSessionManager"/> ebből képzi a botonkénti végpontokat.</summary>
    public string? BaseUrl { get; private set; }

    /// <summary>
    /// Elindítja a szervert. A hívási sorrend kötött: ennek a <see cref="BotSessionManager"/>
    /// létrehozása ELŐTT kell lefutnia, mert a botok indításakor már ismert végpontot kell átadni
    /// a `claude.exe`-nek. A menedzser és a busz csak utána köthető be (<see cref="Attach"/>).
    /// Hiba esetén nem dob: a csatorna nélkül az alkalmazás minden más funkciója működik.
    /// </summary>
    public async Task StartAsync()
    {
        try
        {
            var builder = WebApplication.CreateSlimBuilder(new WebApplicationOptions
            {
                // A WinForms alkalmazás aktuális könyvtára nem feltétlenül az exe mappája, a
                // host viszont ehhez képest oldana fel konfigurációs fájlokat.
                ContentRootPath = AppContext.BaseDirectory,
            });

            // WinExe: nincs konzol, ahová a Kestrel naplózna; a saját hibáinkat a tool-válaszok és
            // a bot debug naplója (UC-007) hordozzák.
            builder.Logging.ClearProviders();

            // Port 0 = az OS ad szabad portot. Kizárólag loopback: a csatorna soha nem lóghat ki a
            // gépről, és így tűzfal-kérdés sem jelenik meg a felhasználónak.
            builder.WebHost.ConfigureKestrel(options => options.Listen(IPAddress.Loopback, 0));

            builder.Services.AddSingleton(_backend);
            builder.Services.AddScoped<CallerBotAccessor>();
            builder.Services.AddScoped<ChannelTools>();

            // Stateless mód: minden tool-hívás önálló HTTP kérés, a saját DI-scope-jában fut —
            // így a hívó bot kiléte (scoped CallerBotAccessor) megbízhatóan eljut a tool-ig.
            builder.Services
                .AddMcpServer()
                .WithHttpTransport(options => options.Stateless = true)
                .WithTools<ChannelTools>();

            var app = builder.Build();

            app.Use(async (context, next) =>
            {
                if (!TryResolveCaller(context, out var bot))
                {
                    // Ismeretlen vagy hiányzó token: nem adunk támpontot arról, hogy létezik-e a
                    // végpont — egyszerűen nincs ilyen erőforrás.
                    context.Response.StatusCode = (int)HttpStatusCode.NotFound;
                    return;
                }

                context.RequestServices.GetRequiredService<CallerBotAccessor>().Bot = bot;
                await next();
            });

            app.MapMcp(PathPrefix + "{token}");

            await app.StartAsync();

            _app = app;
            BaseUrl = app.Urls.FirstOrDefault()?.TrimEnd('/');
        }
        catch (Exception)
        {
            // A csatorna hiánya nem akadályozhatja meg az alkalmazás indulását: a botok ilyenkor
            // egyszerűen csatorna-tool-ok nélkül futnak (ld. BotSession.ChannelMcpUrl).
            BaseUrl = null;
        }
    }

    /// <summary>A menedzser és a busz bekötése. Azért külön lépés, mert a két irányú függés
    /// (a szervernek busz kell, a buszhoz előbb elinduló botok, azokhoz pedig már élő végpont)
    /// másképp körkörös lenne.</summary>
    public void Attach(BotSessionManager manager, BotMessageBus bus)
    {
        _backend.Manager = manager;
        _backend.Bus = bus;
    }

    public void Stop()
    {
        try
        {
            _app?.StopAsync(TimeSpan.FromSeconds(2)).Wait(TimeSpan.FromSeconds(3));
        }
        catch
        {
            // a leállítás közbeni hibák nem akadályozhatják az app bezárását
        }
    }

    /// <summary>A tokent közvetlenül az útvonalból olvassuk ki, nem a route-értékekből: így
    /// független attól, hol fut a routing middleware a csővezetékben.</summary>
    private bool TryResolveCaller(HttpContext context, out BotSession bot)
    {
        bot = null!;

        var path = context.Request.Path.Value;
        if (path == null || !path.StartsWith(PathPrefix, StringComparison.Ordinal))
            return false;

        var token = path[PathPrefix.Length..].Trim('/');
        if (token.Length == 0)
            return false;

        var resolved = _backend.Manager?.ResolveByChannelToken(token);
        if (resolved == null)
            return false;

        bot = resolved;
        return true;
    }
}

/// <summary>A szerver és a bot-réteg közötti, utólag kitöltött kapocs (ld.
/// <see cref="ChannelMcpServer.Attach"/>).</summary>
public sealed class ChannelBackend
{
    public BotSessionManager? Manager { get; set; }
    public BotMessageBus? Bus { get; set; }
}

/// <summary>A HTTP kérés scope-jába tett hívó bot — a middleware tölti ki az URL tokenjéből.</summary>
public sealed class CallerBotAccessor
{
    public BotSession? Bot { get; set; }
}

/// <summary>
/// A botok számára látható tool-ok. Ez az egyetlen hely, ahonnan a bot megtudja, hogyan működik a
/// csatorna — ezért a leírások szándékosan bőbeszédűek, és magukban hordozzák a használati
/// etikettet is.
/// </summary>
[McpServerToolType]
public sealed class ChannelTools
{
    private readonly ChannelBackend _backend;
    private readonly CallerBotAccessor _caller;

    public ChannelTools(ChannelBackend backend, CallerBotAccessor caller)
    {
        _backend = backend;
        _caller = caller;
    }

    [McpServerTool(Name = "list_bots", ReadOnly = true),
     Description("Felsorolja a többi botot a közös csatornán: a nevüket, azt hogy éppen futnak-e, " +
                 "és — ha definiálva van — azt is, hogy mivel foglalkoznak. Ezzel tudod eldönteni, " +
                 "kinek érdemes feladatot delegálni vagy kérdést feltenni.")]
    public string ListBots()
    {
        if (!TryGetContext(out var bus, out var caller, out var error))
            return error;

        var participants = bus.ListParticipants(caller);
        if (participants.Count == 0)
            return "Rajtad kívül nincs másik bot a rendszerben.";

        var lines = participants.Select(p =>
        {
            var state = !p.ChannelEnabled
                ? "nincs a csatornán"
                : p.Status == BotStatus.Running ? "fut" : "nem fut";

            return p.Description == null
                ? $"- {p.DisplayName} ({state})"
                : $"- {p.DisplayName} ({state}): {p.Description}";
        });

        return string.Join("\n", lines);
    }

    [McpServerTool(Name = "send_message"),
     Description("Üzenetet küld a többi botnak a közös csatornán: feladat delegálása, kérdés, vagy " +
                 "egy korábbi kérdésre adott válasz. A kommunikáció ASZINKRON — ez a hívás azonnal " +
                 "visszatér, a címzett válasza (ha válaszol) később, külön üzenetként érkezik meg " +
                 "hozzád. Mindig fogalmazz önmagában érthetően: a címzett nem látja a te " +
                 "beszélgetésedet, csak ezt a szöveget kapja meg.")]
    public string SendMessage(
        [Description("Az üzenet szövege. Írd bele a szükséges kontextust is, és azt, hogy pontosan " +
                     "mit vársz a címzettől.")]
        string message,
        [Description("A címzett bot(ok) neve a `list_bots` szerint. Ha elhagyod, az üzenet minden " +
                     "másik bothoz kimegy — ezt csak akkor tedd, ha tényleg mindenkinek szól.")]
        string[]? to = null)
    {
        if (!TryGetContext(out var bus, out var caller, out var error))
            return error;

        return bus.Publish(caller, message, to);
    }

    [McpServerTool(Name = "recent_messages", ReadOnly = true),
     Description("Visszaadja a csatorna legutóbbi üzeneteit — azokat is, amiket nem te kaptál meg " +
                 "(például mert éppen nem futottál). Akkor hasznos, ha fel akarsz zárkózni arra, " +
                 "miről beszélgettek a botok.")]
    public string RecentMessages(
        [Description("Hány üzenetet adjon vissza (alapértelmezés: 20).")] int limit = 20)
    {
        if (!TryGetContext(out var bus, out _, out var error))
            return error;

        var messages = bus.Recent(limit);
        if (messages.Count == 0)
            return "A csatornán még nem volt üzenet.";

        var lines = messages.Select(m =>
        {
            var addressees = m.To.Count == 0 ? "mindenki" : string.Join(", ", m.To);
            return $"[{m.SentAt:MM-dd HH:mm}] {m.FromDisplayName} → {addressees}: {m.Text}";
        });

        return string.Join("\n", lines);
    }

    /// <summary>A szerver a botok indulása előtt elindul, a busz viszont csak utánuk kötődik be —
    /// egy ebben a résben érkező hívásra értelmes hibaszöveget adunk, nem kivételt.</summary>
    private bool TryGetContext(out BotMessageBus bus, out BotSession caller, out string error)
    {
        bus = _backend.Bus!;
        caller = _caller.Bot!;

        if (_backend.Bus == null || _caller.Bot == null)
        {
            error = "A bot-csatorna jelenleg nem érhető el. Próbáld újra később.";
            return false;
        }

        error = "";
        return true;
    }
}
