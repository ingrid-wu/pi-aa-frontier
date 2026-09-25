import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Input, Text, matchesKey } from '@earendil-works/pi-tui';

export function promptApiKey(ctx: ExtensionContext, signal: AbortSignal) {
  return ctx.ui.custom<string | undefined>((tui, _theme, _keys, done) => {
    const input = new Input();
    let error = '';
    const close = (value?: string) => {
      input.setValue('');
      signal.removeEventListener('abort', abort);
      done(value);
    };
    const abort = () => close();
    signal.addEventListener('abort', abort, { once: true });
    input.onEscape = abort;
    input.onSubmit = value => {
      const key = value.trim();
      if (!key || !/^[\x21-\x7e]+$/.test(key)) {
        error = 'Enter a non-empty API key without spaces or control characters.';
        return;
      }
      close(key);
    };
    return {
      render(width: number) {
        return new Text([
          'AA Frontier setup',
          'Get your Artificial Analysis API key at https://artificialanalysis.ai/api',
          'Saved locally in ~/.pi/agent/aa-frontier/api-key (owner-only permissions).',
          'The key is not added to chat or sent to the model.',
          '',
          `API key: ${'*'.repeat(Math.min(input.getValue().length, 40))}`,
          error || 'Paste or type your key. Enter to save; Esc to skip.',
        ].join('\n'), 0, 0).render(width);
      },
      handleInput(data: string) {
        if (signal.aborted || matchesKey(data, 'ctrl+c')) { close(); return; }
        error = '';
        input.handleInput(data);
        tui.requestRender();
      },
      invalidate() {},
      dispose() {
        signal.removeEventListener('abort', abort);
        input.setValue('');
      },
    };
  });
}
