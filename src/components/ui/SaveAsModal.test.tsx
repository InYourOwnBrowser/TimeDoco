import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SaveAsModal, sanitizeFilename } from './SaveAsModal';

describe('sanitizeFilename', () => {
  it('removes invalid Windows characters and trims whitespace', () => {
    expect(sanitizeFilename('my/file:name*?.pdf')).toBe('myfilename.pdf');
    expect(sanitizeFilename('  report <2025> "v1" | test\\  ')).toBe('report 2025 v1  test');
    expect(sanitizeFilename('valid-file-name')).toBe('valid-file-name');
  });

  it('returns empty string if all characters were invalid or whitespace', () => {
    expect(sanitizeFilename('  /\\:*?"<>|  ')).toBe('');
  });
});

describe('SaveAsModal', () => {
  it('renders default filename and extension badge', () => {
    render(
      <SaveAsModal
        isOpen={true}
        defaultFilename="time-report-2025-05-10"
        extension="pdf"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText('Save File As')).not.toBeNull();
    const input = screen.getByDisplayValue('time-report-2025-05-10') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(screen.getByText('.pdf')).not.toBeNull();
  });

  it('calls onConfirm with sanitized filename when submitted', () => {
    const onConfirm = vi.fn();
    render(
      <SaveAsModal
        isOpen={true}
        defaultFilename="time-report-2025-05-10"
        extension="csv"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );

    const input = screen.getByDisplayValue('time-report-2025-05-10');
    fireEvent.change(input, { target: { value: 'custom-export-name' } });

    const saveBtn = screen.getByText('Save');
    fireEvent.click(saveBtn);

    expect(onConfirm).toHaveBeenCalledWith('custom-export-name');
  });

  it('shows error when user clears filename and attempts to save', () => {
    const onConfirm = vi.fn();
    render(
      <SaveAsModal
        isOpen={true}
        defaultFilename="time-report-2025-05-10"
        extension="csv"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );

    const input = screen.getByDisplayValue('time-report-2025-05-10');
    fireEvent.change(input, { target: { value: '   ' } });

    const saveBtn = screen.getByText('Save');
    fireEvent.click(saveBtn);

    expect(screen.getByText('Please enter a valid filename.')).not.toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('calls onCancel when Cancel button is clicked', () => {
    const onCancel = vi.fn();
    render(
      <SaveAsModal
        isOpen={true}
        defaultFilename="time-report-2025-05-10"
        extension="ics"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />
    );

    const cancelBtn = screen.getByText('Cancel');
    fireEvent.click(cancelBtn);

    expect(onCancel).toHaveBeenCalled();
  });
});
