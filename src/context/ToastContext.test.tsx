import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ToastProvider, useToast } from './ToastContext';

const TestComponent = () => {
  const { addToast } = useToast();
  return (
    <div>
      <button onClick={() => addToast('Test Toast', 'info')}>Add Toast</button>
    </div>
  );
};

describe('ToastContext', () => {
  it('adds toast using crypto.randomUUID for toast ID', async () => {
    const randomUuidSpy = vi.spyOn(crypto, 'randomUUID');

    render(
      <ToastProvider>
        <TestComponent />
      </ToastProvider>
    );

    const button = screen.getByText('Add Toast');
    await act(async () => {
      button.click();
    });

    expect(screen.getByText('Test Toast')).toBeDefined();
    expect(randomUuidSpy).toHaveBeenCalledTimes(1);

    randomUuidSpy.mockRestore();
  });
});
