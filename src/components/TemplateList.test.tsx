import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TemplateList } from './TemplateList';
import type { Group, Timecode } from '../types';

const mockUpdateSettings = vi.fn().mockResolvedValue(true);

// Archived first, on purpose: it is what `timecodes[0]` would have handed the
// new-template form.
const mockTimecodes: Timecode[] = [
  { id: 'tc-archived', name: 'Retired Retainer', groupId: 'grp-live', hourlyRate: 50, archived: true, updatedAt: '2025-01-01T00:00:00Z' },
  { id: 'tc-in-archived-group', name: 'Old Client Work', groupId: 'grp-archived', hourlyRate: 60, archived: false, updatedAt: '2025-01-01T00:00:00Z' },
  { id: 'tc-live', name: 'Billable Consulting', groupId: 'grp-live', hourlyRate: 85, archived: false, updatedAt: '2025-01-01T00:00:00Z' },
  { id: 'tc-other', name: 'Internal Admin', groupId: 'grp-live', hourlyRate: null, archived: false, updatedAt: '2025-01-01T00:00:00Z' },
];

const mockGroups: Group[] = [
  { id: 'grp-live', name: 'Client Alpha', color: '#10b981', archived: false, updatedAt: '2025-01-01T00:00:00Z' },
  { id: 'grp-archived', name: 'Client Omega', color: '#888888', archived: true, updatedAt: '2025-01-01T00:00:00Z' },
];

vi.mock('../context/TimeTrackerContext', () => ({
  useTimeTracker: () => ({
    settings: { currencySymbol: '$', templates: [] },
    updateSettings: mockUpdateSettings,
    restoreTemplate: vi.fn(),
    addManualEntry: vi.fn().mockResolvedValue(true),
    startTimer: vi.fn().mockResolvedValue(undefined),
    timecodes: mockTimecodes,
    groups: mockGroups,
    entries: [],
  }),
}));

vi.mock('../context/ToastContext', () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));

const openNewTemplate = () => {
  render(<TemplateList />);
  fireEvent.click(screen.getByText(/New Template/i));
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TemplateList', () => {
  it('defaults a new template to a timecode the picker will actually offer', () => {
    openNewTemplate();

    // Not 'Retired Retainer', which is archived, and not 'Old Client Work',
    // whose group is: the picker hides both, so a template saved against
    // either would point at something the user cannot see or select.
    expect(screen.getByRole('combobox')).toHaveProperty('value', 'Billable Consulting');
  });

  it('saves the template against that default', async () => {
    openNewTemplate();

    fireEvent.change(screen.getByPlaceholderText('e.g. Daily Standup'), { target: { value: 'Weekly Review' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save/ }));

    await waitFor(() => expect(mockUpdateSettings).toHaveBeenCalled());
    const [{ templates }] = mockUpdateSettings.mock.calls[0] as [{ templates: { timecodeId: string }[] }];
    expect(templates[0].timecodeId).toBe('tc-live');
  });

  it('closes an untouched form without interrupting', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    openNewTemplate();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(confirm).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it('treats a changed timecode as an unsaved edit', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    openNewTemplate();

    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(await screen.findByText('Internal Admin'));

    // The timecode is the one field a user can change without typing anything,
    // and losing that choice silently on Escape is the same loss as any other.
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('unsaved changes'));
    confirm.mockRestore();
  });
});
