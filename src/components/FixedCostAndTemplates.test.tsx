import { render, fireEvent, waitFor, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { format } from 'date-fns';
import { AnalysisView } from './AnalysisView';
import { TemplateList } from './TemplateList';
import { ManualEntryModal } from './ManualEntryModal';

// These resolve to whether the write was stored; callers gate their success
// toast and their close on that.
const mockUpdateSettings = vi.fn().mockResolvedValue(true);
const mockAddManualEntry = vi.fn().mockResolvedValue(true);
const mockStartTimer = vi.fn().mockResolvedValue(undefined);
const mockAddToast = vi.fn();

const todayNoon = format(new Date(), "yyyy-MM-dd'T'12:00:00");

const mockEntries = [
  {
    id: 'entry-fixed-1',
    timecodeId: 'tc-1',
    startTime: todayNoon,
    endTime: todayNoon,
    duration: 0,
    note: 'Materials fee',
    manualAmount: 150.00,
    pausedSegments: [],
    tags: [],
  }
];

const mockTimecodes = [
  {
    id: 'tc-1',
    name: 'Materials & Expenses',
    groupId: 'grp-1',
    color: '#10b981',
    hourlyRate: 0,
    archived: false,
  },
  {
    id: 'tc-billable',
    name: 'Billable Consulting',
    groupId: 'grp-1',
    color: '#3b82f6',
    hourlyRate: 85,
    archived: false,
  }
];

const mockGroups = [
  {
    id: 'grp-1',
    name: 'Client Alpha',
    color: '#10b981',
    archived: false,
  }
];

const mockSettings = {
  currencySymbol: '$',
  taxEnabled: false,
  templates: [
    {
      id: 'template-1',
      title: 'Daily Standup',
      timecodeId: 'tc-1',
      durationMinutes: 15,
      note: 'Team sync',
    },
    // Its timecode is in the trash, so it is not in `mockTimecodes`. Deleting a
    // timecode is reversible, so its templates are kept rather than destroyed —
    // they are only hidden until it is restored.
    {
      id: 'template-trashed',
      title: 'Archived Ritual',
      timecodeId: 'tc-trashed',
      durationMinutes: 30,
      note: 'On a trashed timecode',
    }
  ]
};

vi.mock('../context/TimeTrackerContext', () => ({
  useTimeTracker: () => ({
    entries: mockEntries,
    timecodes: mockTimecodes,
    groups: mockGroups,
    settings: mockSettings,
    updateSettings: mockUpdateSettings,
    addManualEntry: mockAddManualEntry,
    startTimer: mockStartTimer,
  }),
}));

vi.mock('../context/ToastContext', () => ({
  useToast: () => ({
    addToast: mockAddToast,
  }),
}));

describe('Fixed Cost & Template Deletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('AnalysisView with Fixed Cost Entries', () => {
    it('includes zero-duration entries with manualAmount in breakdown and total earnings', () => {
      render(<AnalysisView />);

      const overviewTab = screen.getByRole('tab', { name: /overview/i });
      fireEvent.click(overviewTab);

      expect(screen.getByText('TOTAL EARNINGS')).not.toBeNull();
      expect(screen.getAllByText('$150.00').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Materials & Expenses').length).toBeGreaterThan(0);
    });
  });

  describe('TemplateList Functionality', () => {
    it('opens new template modal with Fixed duration unchecked by default and supports tags', async () => {
      render(<TemplateList />);

      const newBtn = screen.getByText(/New Template/i);
      fireEvent.click(newBtn);

      const fixedCheckbox = screen.getByLabelText('Fixed duration') as HTMLInputElement;
      expect(fixedCheckbox.checked).toBe(false);

      const titleInput = screen.getByPlaceholderText('e.g. Daily Standup');
      fireEvent.change(titleInput, { target: { value: 'Feature Work' } });

      const tagsInput = screen.getByPlaceholderText('e.g. design, meeting, high-priority');
      fireEvent.change(tagsInput, { target: { value: 'dev, priority-1' } });

      const saveBtn = screen.getByText('Save Template');
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(mockUpdateSettings).toHaveBeenCalledWith(expect.objectContaining({
          templates: expect.arrayContaining([
            expect.objectContaining({
              title: 'Feature Work',
              durationMinutes: null,
              tags: ['dev', 'priority-1'],
            })
          ])
        }));
      });
    });

    it('sends only the templates delta so a concurrent tab is not clobbered', async () => {
      render(<TemplateList />);

      fireEvent.click(screen.getByText(/New Template/i));
      fireEvent.change(screen.getByPlaceholderText('e.g. Daily Standup'), { target: { value: 'Admin' } });
      fireEvent.click(screen.getByText('Save Template'));

      await waitFor(() => {
        expect(mockUpdateSettings).toHaveBeenCalled();
      });

      const updates = mockUpdateSettings.mock.calls[0][0];
      expect(Object.keys(updates)).toEqual(['templates']);
    });

    it('passes template tags when logging a timer template or fixed duration template', async () => {
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
      render(<TemplateList />);

      // Test fixed duration template (Daily Standup in mockSettings)
      const templateChip = screen.getByRole('button', { name: 'Log Daily Standup' });
      fireEvent.click(templateChip);

      await waitFor(() => {
        expect(mockAddManualEntry).toHaveBeenCalledWith(expect.objectContaining({
          timecodeId: 'tc-1',
          note: 'Team sync',
          tags: undefined,
        }));
      });

      confirmSpy.mockRestore();
    });
  });

  describe('TemplateList visibility', () => {
    it('hides a template whose timecode is in the trash and shows the rest', () => {
      render(<TemplateList />);

      expect(screen.getByRole('button', { name: 'Log Daily Standup' })).not.toBeNull();
      expect(screen.queryByRole('button', { name: 'Log Archived Ritual' })).toBeNull();
    });
  });

  describe('TemplateList Deletion Confirmation', () => {
    it('cancels deletion when window.confirm returns false', () => {
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

      const { container } = render(<TemplateList />);
      const deleteBtn = container.querySelector('button[aria-label="Delete template"]') as HTMLButtonElement;
      expect(deleteBtn).not.toBeNull();

      fireEvent.click(deleteBtn);

      expect(confirmSpy).toHaveBeenCalledWith('Delete template "Daily Standup"? This can be undone from the toast for a few seconds.');
      expect(mockUpdateSettings).not.toHaveBeenCalled();

      confirmSpy.mockRestore();
    });

    it('proceeds with deletion when window.confirm returns true', () => {
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

      const { container } = render(<TemplateList />);
      const deleteBtn = container.querySelector('button[aria-label="Delete template"]') as HTMLButtonElement;
      expect(deleteBtn).not.toBeNull();

      fireEvent.click(deleteBtn);

      expect(confirmSpy).toHaveBeenCalledWith('Delete template "Daily Standup"? This can be undone from the toast for a few seconds.');
      // Only the templates delta — passing the whole snapshot would make
      // updateSettings' re-read-and-merge overwrite every other field. The
      // template hidden behind a trashed timecode survives: the write is
      // derived from the stored list, not from the filtered one on screen.
      expect(mockUpdateSettings).toHaveBeenCalledWith({
        templates: [expect.objectContaining({ id: 'template-trashed' })],
      });

      confirmSpy.mockRestore();
    });
  });

  describe('ManualEntryModal Fixed Cost Mode', () => {
    it('switches to fixed cost mode when Flat Fee button is clicked and calls addManualEntry with noon local time ISO string', async () => {
      const onClose = vi.fn();
      const { container } = render(<ManualEntryModal onClose={onClose} />);

      const timecodeCombo = screen.getByPlaceholderText('Select or type to create...');
      fireEvent.click(timecodeCombo);

      const options = screen.getAllByText('Materials & Expenses');
      fireEvent.click(options[options.length - 1]);

      const flatFeeBtn = screen.getByRole('button', { name: 'Flat Fee' });
      expect(flatFeeBtn).not.toBeNull();
      fireEvent.click(flatFeeBtn);

      const dateInput = container.querySelector('input[type="date"]') as HTMLInputElement;
      expect(dateInput).not.toBeNull();
      fireEvent.change(dateInput, { target: { value: '2025-05-10' } });

      const amountInput = screen.getByPlaceholderText('e.g. 150.00') as HTMLInputElement;
      fireEvent.change(amountInput, { target: { value: '250.00' } });

      const saveBtn = screen.getByText('Add Entry');
      fireEvent.click(saveBtn);

      await waitFor(() => {
        const expectedDate = new Date('2025-05-10T12:00:00').toISOString();
        expect(mockAddManualEntry).toHaveBeenCalledWith({
          timecodeId: 'tc-1',
          startTime: expectedDate,
          endTime: expectedDate,
          note: '',
          tags: [],
          pausedSegments: [],
          manualAmount: 250,
        });
        expect(onClose).toHaveBeenCalled();
      });
    });

    /** Drive the modal into flat-fee mode with a date and the given amount. */
    const submitFlatFee = (container: HTMLElement, amount: string) => {
      fireEvent.click(screen.getByPlaceholderText('Select or type to create...'));
      const options = screen.getAllByText('Materials & Expenses');
      fireEvent.click(options[options.length - 1]);

      fireEvent.click(screen.getByRole('button', { name: 'Flat Fee' }));

      const dateInput = container.querySelector('input[type="date"]') as HTMLInputElement;
      fireEvent.change(dateInput, { target: { value: '2025-05-10' } });

      const amountInput = screen.getByPlaceholderText('e.g. 150.00') as HTMLInputElement;
      fireEvent.change(amountInput, { target: { value: amount } });

      fireEvent.click(screen.getByText('Add Entry'));
    };

    // C-1: `ce388d3` taught the reports to print a negative amount, but this
    // gate still rejected one, so a credit could not be recorded in the first
    // place. The timed-entry path in the same file already allowed it.
    it('records a negative flat fee as a credit', async () => {
      const { container } = render(<ManualEntryModal onClose={vi.fn()} />);

      submitFlatFee(container, '-250.00');

      await waitFor(() => {
        expect(mockAddManualEntry).toHaveBeenCalledWith(
          expect.objectContaining({ manualAmount: -250 }),
        );
      });
    });

    it('still rejects a zero flat fee', async () => {
      const { container, findByText } = render(<ManualEntryModal onClose={vi.fn()} />);

      submitFlatFee(container, '0');

      expect(await findByText(/non-zero fixed amount/i)).toBeTruthy();
      expect(mockAddManualEntry).not.toHaveBeenCalled();
    });

    it('confirms before a flat fee throws away times already typed into the form', async () => {
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
      const onClose = vi.fn();
      const { container } = render(<ManualEntryModal onClose={onClose} />);

      const timecodeCombo = screen.getByPlaceholderText('Select or type to create...');
      fireEvent.click(timecodeCombo);
      const options = screen.getAllByText('Materials & Expenses');
      fireEvent.click(options[options.length - 1]);

      const [startInput, endInput] = Array.from(
        container.querySelectorAll('input[type="datetime-local"]')
      );
      fireEvent.change(startInput, { target: { value: '2025-05-10T09:00:00' } });
      fireEvent.change(endInput, { target: { value: '2025-05-10T17:00:00' } });

      fireEvent.click(screen.getByRole('button', { name: 'Flat Fee' }));
      // The warning is on screen before the user commits to it.
      expect(screen.getByText(/will not be saved/)).toBeTruthy();

      fireEvent.change(screen.getByPlaceholderText('e.g. 150.00'), { target: { value: '250.00' } });
      fireEvent.click(screen.getByText('Add Entry'));

      await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
      expect(confirmSpy.mock.calls[0][0]).toContain('8h');
      expect(mockAddManualEntry).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();

      confirmSpy.mockRestore();
    });

    it('allows flat fee entries for timecodes WITH an hourly rate', async () => {
      const onClose = vi.fn();
      render(<ManualEntryModal onClose={onClose} />);

      const timecodeCombo = screen.getByPlaceholderText('Select or type to create...');
      fireEvent.click(timecodeCombo);

      const options = screen.getAllByText('Billable Consulting');
      fireEvent.click(options[options.length - 1]);

      const flatFeeBtn = screen.getByRole('button', { name: 'Flat Fee' });
      expect(flatFeeBtn).not.toBeNull();
      fireEvent.click(flatFeeBtn);

      const amountInput = screen.getByPlaceholderText('e.g. 150.00') as HTMLInputElement;
      fireEvent.change(amountInput, { target: { value: '500.00' } });

      const saveBtn = screen.getByText('Add Entry');
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(mockAddManualEntry).toHaveBeenCalledWith(expect.objectContaining({
          timecodeId: 'tc-billable',
          manualAmount: 500,
        }));
        expect(onClose).toHaveBeenCalled();
      });
    });
  });
});
