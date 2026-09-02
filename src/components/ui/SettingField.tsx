import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useDeferredWrite } from '../../hooks/useDeferredWrite';

/**
 * A settings input that writes when the user stops typing, not on every
 * keystroke.
 *
 * Each `handleUpdateSettings` call is a read of the stored record, a merge, an
 * IndexedDB write and a cross-tab broadcast — and every other open tab answers
 * that broadcast with a full four-store reload. Wired straight to `onChange`
 * that is one of those per character typed. Beyond the cost, the writes are
 * read-modify-write, so overlapping ones could drop characters.
 *
 * Holding the draft locally and flushing on idle, blur, Enter or unmount makes
 * that impossible rather than fixing it a field at a time: a field written this
 * way cannot issue a write per keystroke however it is used, and cannot lose
 * one either. The scheduling itself lives in `useDeferredWrite`, so the next
 * field that needs it does not hand-roll the version whose cleanup discards the
 * pending write.
 *
 * The value is a string, as the DOM has it. Callers parse in `onCommit`,
 * exactly as they used to in `onChange`.
 */
export interface SettingFieldProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  /** The stored value. Re-seeds the draft, but never mid-edit. */
  value: string;
  /** Called with the draft once it settles. Never per keystroke. */
  onCommit: (value: string) => void;
  /** Render a textarea instead of an input. */
  multiline?: boolean;
  rows?: number;
  debounceMs?: number;
}

export const SettingField: React.FC<SettingFieldProps> = ({
  value,
  onCommit,
  multiline = false,
  debounceMs = 500,
  onBlur,
  onKeyDown,
  ...rest
}) => {
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(value);
  // True from the first keystroke until the draft is written.
  const dirtyRef = useRef(false);
  // Read through a ref so a caller passing an inline arrow — which every one of
  // them does — cannot restart the debounce on each render.
  const onCommitRef = useRef(onCommit);
  // Updated after commit rather than during render. Every flush happens on blur,
  // Enter, idle or unmount — all after the commit that set this — so the timing
  // is unchanged, and writing a ref in the render body is a side effect that
  // concurrent rendering may run more than once or throw away.
  useEffect(() => {
    onCommitRef.current = onCommit;
  });

  // Idle, blur and Enter flush through this; unmount flushes inside the hook,
  // so closing the modal writes what was typed into it rather than dropping it.
  const { schedule, flush } = useDeferredWrite(debounceMs);

  useEffect(() => {
    // A change from outside: another tab saved, or the panel reloaded. Take it,
    // but never over something the user is part-way through typing.
    if (dirtyRef.current) return;
    setDraft(value);
    draftRef.current = value;
  }, [value]);

  const commitDraft = useCallback(() => {
    dirtyRef.current = false;
    onCommitRef.current(draftRef.current);
  }, []);

  const handleChange = (
    event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    const next = event.target.value;
    setDraft(next);
    draftRef.current = next;
    dirtyRef.current = true;
    schedule(commitDraft);
  };

  const shared = {
    value: draft,
    onChange: handleChange,
    onBlur: (event: React.FocusEvent<HTMLInputElement & HTMLTextAreaElement>) => {
      void flush();
      onBlur?.(event);
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement & HTMLTextAreaElement>) => {
      // Enter reads as "I am done with this field", so honour it rather than
      // making the user wait out the debounce or click elsewhere.
      if (event.key === 'Enter' && !multiline) void flush();
      onKeyDown?.(event);
    },
  };

  if (multiline) {
    const { type: _type, ...textareaProps } =
      rest as React.TextareaHTMLAttributes<HTMLTextAreaElement> & { type?: string };
    return <textarea {...textareaProps} {...shared} />;
  }

  return <input {...rest} {...shared} />;
};
