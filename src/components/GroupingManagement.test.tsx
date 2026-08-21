import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GroupingManagement } from './GroupingManagement';
import type { Group, Timecode, Entry } from '../types';

const mockAddGroup = vi.fn().mockResolvedValue({ id: 'g3', name: 'New Client', color: '#3E7368' });
const mockUpdateGroup = vi.fn().mockResolvedValue(undefined);
const mockDeleteGroup = vi.fn().mockResolvedValue(undefined);
const mockAddTimecode = vi.fn().mockResolvedValue({ id: 'tc4', name: 'New Task', groupId: 'g1' });
const mockUpdateTimecode = vi.fn().mockResolvedValue(undefined);
const mockDeleteTimecode = vi.fn().mockResolvedValue(undefined);
const mockMergeTimecodes = vi.fn().mockResolvedValue(undefined);
const mockAddToast = vi.fn();

const sampleGroups: Group[] = [
  { id: 'g1', name: 'Client A', color: '#ff0000', archived: false, updatedAt: new Date().toISOString() },
  { id: 'g2', name: 'Client B', color: '#00ff00', archived: false, updatedAt: new Date().toISOString() },
  { id: 'g-archived', name: 'Old Client', color: '#888888', archived: true, updatedAt: new Date().toISOString() },
];

const sampleTimecodes: Timecode[] = [
  { id: 'tc1', name: 'Design', groupId: 'g1', hourlyRate: 85, archived: false, updatedAt: new Date().toISOString() },
  { id: 'tc2', name: 'Development', groupId: 'g1', hourlyRate: 100, archived: false, updatedAt: new Date().toISOString() },
  { id: 'tc3', name: 'Support', groupId: 'g2', hourlyRate: 75, archived: false, updatedAt: new Date().toISOString() },
  { id: 'tc-nogroup', name: 'Personal Study', groupId: null, hourlyRate: null, archived: false, updatedAt: new Date().toISOString() },
  { id: 'tc-archived', name: 'Legacy Fixes', groupId: 'g1', hourlyRate: 50, archived: true, updatedAt: new Date().toISOString() },
];

const sampleEntries: Entry[] = [
  {
    id: 'e1',
    timecodeId: 'tc1',
    startTime: '2025-01-01T10:00:00Z',
    endTime: '2025-01-01T11:00:00Z',
    duration: 3600,
    note: '',
    tags: [],
    isRunning: false,
    isPaused: false,
    pausedSegments: [],
    editHistory: [],
    createdAt: '2025-01-01T10:00:00Z',
    updatedAt: '2025-01-01T11:00:00Z',
  },
  {
    id: 'e2',
    timecodeId: 'tc1',
    startTime: '2025-01-02T10:00:00Z',
    endTime: '2025-01-02T12:00:00Z',
    duration: 7200,
    note: '',
    tags: [],
    isRunning: false,
    isPaused: false,
    pausedSegments: [],
    editHistory: [],
    createdAt: '2025-01-02T10:00:00Z',
    updatedAt: '2025-01-02T12:00:00Z',
  },
];

vi.mock('../context/TimeTrackerContext', () => ({
  useTimeTracker: () => ({
    groups: sampleGroups,
    timecodes: sampleTimecodes,
    entries: sampleEntries,
    addGroup: mockAddGroup,
    updateGroup: mockUpdateGroup,
    deleteGroup: mockDeleteGroup,
    addTimecode: mockAddTimecode,
    updateTimecode: mockUpdateTimecode,
    deleteTimecode: mockDeleteTimecode,
    mergeTimecodes: mockMergeTimecodes,
    settings: { currencySymbol: '$' },
  }),
}));

vi.mock('../context/ToastContext', () => ({
  useToast: () => ({
    addToast: mockAddToast,
  }),
}));

describe('GroupingManagement Redesigned View', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders groups as collapsible sections with nested timecodes and inline rates', () => {
    render(<GroupingManagement />);

    expect(screen.getByText('Client A')).toBeTruthy();
    expect(screen.getByText('Client B')).toBeTruthy();
    expect(screen.getByText('No Group')).toBeTruthy();

    // Rates displayed inline
    expect(screen.getByText('$85/hr')).toBeTruthy();
    expect(screen.getByText('$100/hr')).toBeTruthy();
    expect(screen.getByText('$75/hr')).toBeTruthy();

    // Entry count hints displayed for tc1 (Design has 2 entries)
    expect(screen.getByText('2 entries')).toBeTruthy();
  });

  it('filters groups and timecodes via search input', () => {
    render(<GroupingManagement />);

    const searchInput = screen.getByPlaceholderText('Search groups & timecodes…');
    fireEvent.change(searchInput, { target: { value: 'Design' } });

    expect(screen.getByText('Client A')).toBeTruthy();
    expect(screen.getByText('Design')).toBeTruthy();
    expect(screen.queryByText('Client B')).toBeNull();
    expect(screen.queryByText('Support')).toBeNull();
  });

  it('allows creating a new group using top "+ New Group" action', async () => {
    render(<GroupingManagement />);

    const newGroupBtn = screen.getByRole('button', { name: /New Group/i });
    fireEvent.click(newGroupBtn);

    const groupNameInput = screen.getByPlaceholderText(/Group Name/i);
    fireEvent.change(groupNameInput, { target: { value: 'New Client' } });

    const saveBtn = screen.getByRole('button', { name: /Save Group/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockAddGroup).toHaveBeenCalledWith('New Client', expect.any(String));
    });
  });

  it('allows creating a timecode contextually under a specific group', async () => {
    render(<GroupingManagement />);

    const addTcBtn = screen.getByRole('button', { name: /Add timecode to Client A/i });
    fireEvent.click(addTcBtn);

    const tcNameInput = screen.getByPlaceholderText('New Timecode Name');
    fireEvent.change(tcNameInput, { target: { value: 'QA Testing' } });

    const rateInput = screen.getByPlaceholderText('Rate');
    fireEvent.change(rateInput, { target: { value: '90' } });

    const saveTcBtn = screen.getByRole('button', { name: 'Add Timecode' });
    fireEvent.click(saveTcBtn);

    await waitFor(() => {
      expect(mockAddTimecode).toHaveBeenCalledWith('QA Testing', expect.any(String), 'g1', 90);
    });
  });

  it('opens inline expansion panel to edit group and saves changes', async () => {
    render(<GroupingManagement />);

    const editGroupBtns = screen.getAllByRole('button', { name: 'Edit Group' });
    fireEvent.click(editGroupBtns[0]);

    const editNameInput = screen.getByDisplayValue('Client A');
    fireEvent.change(editNameInput, { target: { value: 'Client Alpha' } });

    const saveBtn = screen.getByRole('button', { name: /Save/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockUpdateGroup).toHaveBeenCalledWith('g1', { name: 'Client Alpha', color: '#ff0000' });
    });
  });

  it('opens inline expansion panel to edit timecode and saves changes', async () => {
    render(<GroupingManagement />);

    const editTcBtns = screen.getAllByRole('button', { name: 'Edit Timecode' });
    fireEvent.click(editTcBtns[0]); // Design tc1

    const editTcNameInput = screen.getByDisplayValue('Design');
    fireEvent.change(editTcNameInput, { target: { value: 'UI/UX Design' } });

    const rateInput = screen.getByDisplayValue('85');
    fireEvent.change(rateInput, { target: { value: '95' } });

    const saveBtn = screen.getByRole('button', { name: /Save/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockUpdateTimecode).toHaveBeenCalledWith('tc1', {
        name: 'UI/UX Design',
        color: undefined,
        groupId: 'g1',
        hourlyRate: 95,
      });
    });
  });

  it('shows archived items disclosure toggle and restores archived items', async () => {
    render(<GroupingManagement />);

    expect(screen.queryByText('Old Client')).toBeNull();

    const showArchivedBtn = screen.getByRole('button', { name: /Show 2 archived items/i });
    fireEvent.click(showArchivedBtn);

    expect(screen.getByText('Old Client')).toBeTruthy();
    expect(screen.getByText('Legacy Fixes')).toBeTruthy();

    const restoreGroupBtn = screen.getByRole('button', { name: 'Restore Group' });
    fireEvent.click(restoreGroupBtn);

    await waitFor(() => {
      expect(mockUpdateGroup).toHaveBeenCalledWith('g-archived', { archived: false });
    });
  });

  it('handles merging timecodes', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<GroupingManagement />);

    const mergeBtns = screen.getAllByRole('button', { name: 'Merge Timecode' });
    fireEvent.click(mergeBtns[0]); // tc1 Design

    const destSelect = screen.getByRole('combobox');
    fireEvent.change(destSelect, { target: { value: 'tc2' } });

    const confirmMergeBtn = screen.getByRole('button', { name: 'Confirm Merge' });
    fireEvent.click(confirmMergeBtn);

    await waitFor(() => {
      expect(mockMergeTimecodes).toHaveBeenCalledWith('tc1', 'tc2');
    });

    confirmSpy.mockRestore();
  });
});
