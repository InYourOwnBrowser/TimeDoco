import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { TimecodeSelector } from './TimecodeSelector';
import { Modal } from './ui/Modal';

const mockTimecodes = [
  { id: 'tc-1', name: 'Alpha', groupId: 'grp-1', color: '#10b981', archived: false },
  { id: 'tc-2', name: 'Beta', groupId: 'grp-1', color: '#3b82f6', archived: false },
  { id: 'tc-3', name: 'Gamma', groupId: null, color: '#ef4444', archived: false },
  { id: 'tc-archived', name: 'Retired', groupId: 'grp-1', color: '#888', archived: true },
  { id: 'tc-in-archived-group', name: 'Orphan', groupId: 'grp-old', color: '#888', archived: false },
];

const mockGroups = [
  { id: 'grp-1', name: 'Client Alpha', color: '#10b981', archived: false },
  { id: 'grp-old', name: 'Former Client', color: '#888', archived: true },
];

const mockEntries = [
  { id: 'e-1', timecodeId: 'tc-3', startTime: '2026-01-01T09:00:00.000Z', pausedSegments: [] },
  { id: 'e-2', timecodeId: 'tc-1', startTime: '2026-01-03T09:00:00.000Z', pausedSegments: [] },
  // Out of order, and a second entry for a timecode already seen: the "recently
  // used" list is by most recent use, not by position in this array.
  { id: 'e-3', timecodeId: 'tc-3', startTime: '2026-01-05T09:00:00.000Z', pausedSegments: [] },
  { id: 'e-bad', timecodeId: 'tc-2', startTime: 'not-a-date', pausedSegments: [] },
];

vi.mock('../context/TimeTrackerContext', () => ({
  useTimeTracker: () => ({
    timecodes: mockTimecodes,
    groups: mockGroups,
    entries: mockEntries,
    settings: { currencySymbol: '$' },
    addTimecode: vi.fn(),
    addGroup: vi.fn(),
  }),
}));

const Harness = ({ inModal = false }: { inModal?: boolean }) => {
  const [selected, setSelected] = useState<string | null>(null);
  const picker = (
    <>
      <button>Outside</button>
      <TimecodeSelector inputId="tc" selectedId={selected} onSelect={setSelected} />
    </>
  );
  return inModal ? <Modal onClose={() => {}} label="Test dialog">{picker}</Modal> : picker;
};

const openList = () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole('combobox'));
  return screen.getByRole('listbox');
};

describe('TimecodeSelector', () => {
  beforeEach(() => vi.clearAllMocks());

  it('offers the unarchived timecodes, and hides those in an archived group', () => {
    const list = openList();

    expect(within(list).getByText('Alpha')).toBeTruthy();
    expect(within(list).getByText('Gamma')).toBeTruthy();
    expect(within(list).queryByText('Retired')).toBeNull();
    expect(within(list).queryByText('Orphan')).toBeNull();
  });

  it('lists the recently used by when they were last used', () => {
    const list = openList();

    // Gamma's later entry wins over Alpha's, and the unparseable start time
    // does not put Beta at the top of the list.
    const recent = within(list)
      .getAllByRole('option')
      .map((option) => option.id)
      .filter((id) => id.startsWith('option-recent-'));

    expect(recent).toEqual(['option-recent-tc-3', 'option-recent-tc-1']);
  });

  it('closes when the next click lands outside, without pressing what it hit', () => {
    const onOutsideClick = vi.fn();
    render(
      <>
        <button onClick={onOutsideClick}>Elsewhere</button>
        <Harness />
      </>,
    );
    // The harness renders a second combobox; act on the first.
    fireEvent.click(screen.getAllByRole('combobox')[0]);
    expect(screen.getAllByRole('listbox').length).toBe(1);

    const elsewhere = screen.getByText('Elsewhere');
    fireEvent.click(elsewhere);

    expect(screen.queryByRole('listbox')).toBeNull();
    // The click that dismissed the list is spent doing exactly that.
    expect(onOutsideClick).not.toHaveBeenCalled();
  });

  it('leaves a click inside the list alone', () => {
    const list = openList();
    const option = within(list).getByText('Alpha');

    fireEvent.click(option);

    expect(screen.getByRole('combobox')).toHaveProperty('value', 'Alpha');
  });

  it('closes the list on Escape and leaves the dialog it is in open', () => {
    const onClose = vi.fn();
    render(
      <Modal onClose={onClose} label="Test dialog">
        <TimecodeSelector inputId="tc" selectedId={null} onSelect={() => {}} />
      </Modal>,
    );

    const combobox = screen.getByRole('combobox');
    fireEvent.click(combobox);
    expect(screen.getByRole('listbox')).toBeTruthy();

    fireEvent.keyDown(combobox, { key: 'Escape' });

    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('TimecodeSelector in a dialog', () => {
  it('renders its options inside the dialog, so the focus trap still holds them', () => {
    render(<Harness inModal />);

    fireEvent.click(screen.getByRole('combobox'));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('listbox')).toBeTruthy();
  });
});
