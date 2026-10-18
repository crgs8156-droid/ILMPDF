import { describe, expect, it } from 'vitest';
import { cleanNote, describeRemoved } from '../../src/core/clean';

const none = { scripts: 0, autoActions: 0, openers: 0, dataActions: 0, attachments: 0, xfa: 0 };

describe('the "Also remove scripts" message', () => {
  it('lists what was removed, with singular and plural words', () => {
    expect(describeRemoved({ ...none, scripts: 1, attachments: 2, xfa: 1 })).toBe('1 script, 2 attached files, an XFA form layer');
    expect(cleanNote({ ...none, scripts: 6 })).toBe(' Also removed 6 scripts.');
  });

  it('says so when nothing was found', () => {
    expect(describeRemoved(none)).toBe('');
    expect(cleanNote(none)).toBe(' No scripts or attached files were found.');
  });
});
