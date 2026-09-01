import { render, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState } from 'react';
import { SettingField } from './SettingField';

/**
 * The contract that makes the per-keystroke write class impossible: a field
 * built this way cannot issue a write per character, however it is wired up.
 */
describe('SettingField', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  const renderField = (props: Partial<React.ComponentProps<typeof SettingField>> = {}) => {
    const onCommit = vi.fn();
    const utils = render(
      <SettingField value="" onCommit={onCommit} placeholder="field" {...props} />,
    );
    return { onCommit, input: utils.getByPlaceholderText('field'), ...utils };
  };

  it('shows what is typed without writing anything', () => {
    const { onCommit, input } = renderField();

    'Acme'.split('').forEach((_, i) => {
      fireEvent.change(input, { target: { value: 'Acme'.slice(0, i + 1) } });
    });

    expect((input as HTMLInputElement).value).toBe('Acme');
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('writes once when typing stops', () => {
    const { onCommit, input } = renderField();

    fireEvent.change(input, { target: { value: 'Ac' } });
    fireEvent.change(input, { target: { value: 'Acme' } });
    act(() => { vi.advanceTimersByTime(500); });

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('Acme');
  });

  it('writes on blur without waiting out the debounce', () => {
    const { onCommit, input } = renderField();

    fireEvent.change(input, { target: { value: 'Acme' } });
    fireEvent.blur(input);

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('Acme');

    // And the pending timer does not then write it a second time.
    act(() => { vi.advanceTimersByTime(1000); });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('writes on Enter', () => {
    const { onCommit, input } = renderField();

    fireEvent.change(input, { target: { value: 'Acme' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onCommit).toHaveBeenCalledWith('Acme');
  });

  it('does not write on Enter inside a textarea, where it is a newline', () => {
    const { onCommit, input } = renderField({ multiline: true });

    fireEvent.change(input, { target: { value: 'Line one' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onCommit).not.toHaveBeenCalled();
  });

  it('writes a pending draft on unmount, so closing the panel keeps it', () => {
    const { onCommit, input, unmount } = renderField();

    fireEvent.change(input, { target: { value: 'Acme' } });
    unmount();

    expect(onCommit).toHaveBeenCalledWith('Acme');
  });

  it('writes nothing when the field was never edited', () => {
    const { onCommit, input, unmount } = renderField({ value: 'Existing' });

    fireEvent.blur(input);
    act(() => { vi.advanceTimersByTime(1000); });
    unmount();

    expect(onCommit).not.toHaveBeenCalled();
  });

  it('takes a value changed from outside while the field is idle', () => {
    const Harness = () => {
      const [value, setValue] = useState('First');
      return (
        <>
          <SettingField value={value} onCommit={() => {}} placeholder="field" />
          <button onClick={() => setValue('From another tab')}>update</button>
        </>
      );
    };
    const { getByPlaceholderText, getByText } = render(<Harness />);

    fireEvent.click(getByText('update'));
    expect((getByPlaceholderText('field') as HTMLInputElement).value).toBe('From another tab');
  });

  it('does not overwrite what the user is part-way through typing', () => {
    const Harness = () => {
      const [value, setValue] = useState('First');
      return (
        <>
          <SettingField value={value} onCommit={() => {}} placeholder="field" />
          <button onClick={() => setValue('From another tab')}>update</button>
        </>
      );
    };
    const { getByPlaceholderText, getByText } = render(<Harness />);
    const input = getByPlaceholderText('field') as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'Half typed' } });
    fireEvent.click(getByText('update'));

    expect(input.value).toBe('Half typed');
  });

  it('writes each edit once across a long session of typing', () => {
    const { onCommit, input } = renderField();

    for (const word of ['one', 'two', 'three']) {
      fireEvent.change(input, { target: { value: word } });
      act(() => { vi.advanceTimersByTime(500); });
    }

    // Three settled edits, three writes — not one per character.
    expect(onCommit).toHaveBeenCalledTimes(3);
    expect(onCommit.mock.calls.map(([v]) => v)).toEqual(['one', 'two', 'three']);
  });
});
