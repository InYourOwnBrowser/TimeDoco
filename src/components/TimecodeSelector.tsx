import React, { useState, useMemo } from 'react';
import { useTimeTracker } from '../context/TimeTrackerContext';
import { Plus, Check, ChevronDown } from 'lucide-react';

const COLORS = ['#ef4444', '#f97316', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#64748b'];

interface TimecodeSelectorProps {
  onSelect: (timecodeId: string) => void;
  selectedId?: string | null;
}

export const TimecodeSelector: React.FC<TimecodeSelectorProps> = ({ onSelect, selectedId }) => {
  const { timecodes, groups, addTimecode } = useTimeTracker();
  const selectedTimecode = selectedId ? timecodes.find(t => t.id === selectedId) : null;
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');

  const [showAddForm, setShowAddForm] = useState(false);
  const [newColor, setNewColor] = useState(COLORS[0]);
  const [newGroupId, setNewGroupId] = useState<string>('');
  const [newHourlyRate, setNewHourlyRate] = useState<string>('');

  const filteredTimecodes = useMemo(() => {
    const unarchived = timecodes.filter(t => !t.archived);
    if (!search) return unarchived;
    return unarchived.filter(t => t.name.toLowerCase().includes(search.toLowerCase()));
  }, [timecodes, search]);

  const exactMatch = filteredTimecodes.find(t => t.name.toLowerCase() === search.toLowerCase());

  const groupedTimecodes = useMemo(() => {
    const grouped = new Map<string | null, typeof timecodes>();
    filteredTimecodes.forEach(t => {
      const gId = t.groupId || null;
      if (!grouped.has(gId)) {
        grouped.set(gId, []);
      }
      grouped.get(gId)!.push(t);
    });
    return grouped;
  }, [filteredTimecodes]);

  const handleSelect = (id: string) => {
    onSelect(id);
    setIsOpen(false);
    setSearch('');
  };

  const handleCreate = async () => {
    if (!search.trim()) return;
    const rate = newHourlyRate ? parseFloat(newHourlyRate) : undefined;
    const newTc = await addTimecode(search.trim(), newColor, newGroupId || undefined, isNaN(rate!) ? undefined : rate);
    onSelect(newTc.id);
    setIsOpen(false);
    setSearch('');
    setShowAddForm(false);
  };

  return (
    <div className="relative w-full max-w-sm">
      <div
        className="flex items-center justify-between px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-600 focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500 transition-colors"
        onClick={() => !isOpen && setIsOpen(true)}
      >
        <input
          type="text"
          className="w-full bg-transparent outline-none cursor-pointer text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
          placeholder="Select or type to create..."
          value={isOpen ? search : (selectedTimecode?.name || search)}
          onChange={(e) => {
            setSearch(e.target.value);
            setIsOpen(true);
            setShowAddForm(false);
          }}
          onClick={(e) => {
            setIsOpen(true);
            e.stopPropagation();
          }}
        />
        <ChevronDown size={18} className="text-gray-400 dark:text-gray-500" />
      </div>

      {isOpen && (
        <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg max-h-96 overflow-y-auto">

          {/* Backdrop for click outside */}
          <div className="fixed inset-0 z-[-1]" onClick={() => {
            setIsOpen(false);
            setSearch('');
            setShowAddForm(false);
          }}></div>

          {showAddForm ? (
            <div className="p-4 bg-gray-50 dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700">
              <h4 className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">Create "{search}"</h4>

              <div className="mb-3">
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Color</label>
                <div className="flex gap-1 flex-wrap">
                  {COLORS.map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setNewColor(c)}
                      className={`w-6 h-6 rounded-full flex items-center justify-center ${newColor === c ? 'ring-2 ring-offset-1 ring-gray-400 dark:ring-gray-300' : ''}`}
                      style={{ backgroundColor: c }}
                    >
                      {newColor === c && <Check size={12} className="text-white" />}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mb-3">
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Group (optional)</label>
                <select
                  className="w-full text-sm p-1.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  value={newGroupId}
                  onChange={(e) => setNewGroupId(e.target.value)}
                >
                  <option value="">No Group</option>
                  {groups.map(g => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
              </div>

              <div className="mb-3">
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Hourly Rate (optional)</label>
                <div className="relative">
                  <span className="absolute left-2.5 top-1.5 text-gray-400 dark:text-gray-500">$</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={newHourlyRate}
                    onChange={(e) => setNewHourlyRate(e.target.value)}
                    className="w-full text-sm p-1.5 pl-6 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowAddForm(false)}
                  className="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreate}
                  className="px-3 py-1.5 text-xs text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 rounded flex items-center gap-1 transition-colors"
                >
                  <Plus size={14} /> Create
                </button>
              </div>
            </div>
          ) : (
            <>
              {search && !exactMatch && (
                <button
                  className="w-full flex items-center gap-2 px-4 py-3 text-left text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-gray-700 border-b border-gray-100 dark:border-gray-700 transition-colors"
                  onClick={() => setShowAddForm(true)}
                >
                  <Plus size={16} />
                  <span className="font-medium">Create "{search}"</span>
                </button>
              )}

              {groups.length === 0 && !timecodes.length && !search && (
                <div className="px-4 py-8 text-center text-gray-500 dark:text-gray-400 text-sm">
                  No timecodes yet. Type to create one.
                </div>
              )}

              {Array.from(groupedTimecodes.entries()).map(([gId, tcs]) => {
                const group = groups.find(g => g.id === gId);
                return (
                  <div key={gId || 'ungrouped'} className="py-1">
                    {group && (
                      <div className="px-3 py-1 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: group.color }}></div>
                        {group.name}
                      </div>
                    )}
                    {tcs.map(tc => {
                      const color = tc.color || group?.color || '#cbd5e1';
                      return (
                        <button
                          key={tc.id}
                          className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700 focus:bg-gray-50 dark:focus:bg-gray-700 outline-none text-gray-900 dark:text-gray-200 transition-colors"
                          onClick={() => handleSelect(tc.id)}
                        >
                          <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: color }}></div>
                          <span className="truncate">{tc.name}</span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
};
