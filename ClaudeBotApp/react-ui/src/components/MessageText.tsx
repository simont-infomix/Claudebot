import { Fragment } from 'react';
import { tokenizeMessage } from './messageTokens';
import './MessageText.css';

interface Props {
  text: string;
  /** A megnyitást a host végzi: webcímnél böngésző, fájlnál az alapértelmezett alkalmazás.
   *  A WebView maga egyiket sem tudná megnyitni — a navigáció itt bent maradna. */
  onOpen: (target: string) => void;
}

/** Egy chat-üzenet szövege, a felismert webcímekkel és fájlútvonalakkal kattinthatóvá téve.
 *  A felismerés (és annak indoklása) a messageTokens modulban él. */
export function MessageText({ text, onOpen }: Props) {
  const tokens = tokenizeMessage(text);

  return (
    <>
      {tokens.map((token, index) => {
        if (token.kind === 'text') {
          return <Fragment key={index}>{token.text}</Fragment>;
        }

        if (token.kind === 'code') {
          return (
            <code key={index} className="msg-code">
              {token.text}
            </code>
          );
        }

        // Nem <a>, hanem <button>: egy valódi href a WebView-ben belső navigációt váltana ki.
        return (
          <button
            key={index}
            type="button"
            className={`msg-link${token.isPath ? ' msg-link--code' : ''}`}
            title={token.target}
            onClick={() => onOpen(token.target)}
          >
            {token.label}
          </button>
        );
      })}
    </>
  );
}
