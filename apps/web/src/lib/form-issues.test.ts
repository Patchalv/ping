import { describe, expect, it } from 'vitest';
import { controlId, firstMessage, serverFieldErrors } from './form-issues';

describe('firstMessage', () => {
  it('reads a zod issue, as a Standard Schema validator leaves it', () => {
    expect(firstMessage([{ message: 'Give the Channel a name.', path: ['name'] }])).toBe(
      'Give the Channel a name.',
    );
  });

  it('reads a plain string, as a server issue is set', () => {
    expect(firstMessage(['That name is taken.'])).toBe('That name is taken.');
  });

  it('takes the first of several and skips empty entries', () => {
    expect(firstMessage([undefined, { message: 'First' }, 'Second'])).toBe('First');
  });

  it('is undefined when there is nothing to say', () => {
    expect(firstMessage([])).toBeUndefined();
    expect(firstMessage([undefined, null, { message: '' }])).toBeUndefined();
  });
});

describe('serverFieldErrors', () => {
  it('keys the server’s issues by field path, keeping the first per field', () => {
    expect(
      serverFieldErrors(
        [
          { path: 'name', message: 'That name is taken.' },
          { path: 'name', message: 'A second complaint' },
          { path: 'visibility', message: 'Choose Public or Private.' },
        ],
        ['name', 'description', 'visibility'],
      ),
    ).toEqual({ name: 'That name is taken.', visibility: 'Choose Public or Private.' });
  });

  it('drops issues for paths the form has no field for', () => {
    expect(serverFieldErrors([{ path: 'owner.id', message: 'No' }], ['name'])).toEqual({});
  });
});

describe('controlId', () => {
  it('ties a field’s control to its form, so two forms on a page never share an id', () => {
    expect(controlId('create-channel', 'name')).toBe('create-channel-name');
    expect(controlId('thread', 'attachments.0')).toBe('thread-attachments-0');
  });
});
