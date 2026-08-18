import React, { useState, useMemo, useEffect } from 'react';
import { useTimeTracker } from '../context/TimeTrackerContext';
import { Plus, Check, ChevronDown, X } from 'lucide-react';

const COLORS = ['#ef4444', '#f97316', '#f59e0b', '#10b981', '#0a0a0a', '#8b5cf6', '#ec4899', '#64748b'];

interface TimecodeSelectorProps {
  onSelect: (timecodeId: string) => void;
  selectedId?: string | null;
}

export const TimecodeSelector: React.FC<TimecodeSelectorProps> = ({ onSelect, selectedId }) => {
  const { timecodes, groups, addTimecode, addGroup, entries, settings } = useTimeTracker();
  const currencySymbol = settings?.currencySymbol || '$';
  const selectedTimecode = selectedId ? timecodes.find(t => t.id === selectedId) : null;
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);

  const [showAddForm, setShowAddForm] = useState(false);
  const [newColor, setNewColor] = useState(COLORS[0]);
  const [newGroupId, setNewGroupId] = useState<string>('');
  const [newHourlyRate, setNewHourlyRate] = useState<string>('');

  const [creatingGroup, setCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');

  const handleCreateGroupInline = async () => {
    const trimmed = newGroupName.trim();
    if (!trimmed) return;
    const color = COLORS[groups.length % COLORS.length];
    const newGroup = await addGroup(trimmed, color);
    setNewGroupId(newGroup.id);
    setCreatingGroup(false);
    setNewGroupName('');
  };

  const filteredTimecodes = useMemo(() => {
    const unarchived = timecodes.filter(t => !t.archived);
    if (!search) return unarchived;
    return unarchived.filter(t => t.name.toLowerCase().includes(search.toLowerCase()));
  }, [timecodes, search]);


  const recentTimecodes = useMemo(() => {
    if (search) return [];

    const unarchived = timecodes.filter(t => !t.archived);
    const sortedEntries = [...entries].sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
    const recentIds = Array.from(new Set(sortedEntries.map(e => e.timecodeId)));

    return recentIds
      .map(id => unarchived.find(t => t.id === id))
      .filter((t): t is typeof timecodes[0] => t !== undefined)
      .slice(0, 3);
  }, [entries, timecodes, search]);

  const exactMatch = filteredTimecodes.find(t => t.name.toLowerCase() === search.toLowerCase());

  const groupedTimecodes = useMemo(() => {
    const grouped = new Map<string | null, typeof timecodes>();
    const recentIds = new Set(recentTimecodes.map(t => t.id));
    filteredTimecodes
      .filter(t => !recentIds.has(t.id))
      .forEach(t => {
        const gId = t.groupId || null;
        if (!grouped.has(gId)) {
          grouped.set(gId, []);
        }
        grouped.get(gId)!.push(t);
      });
    return grouped;
  }, [filteredTimecodes, recentTimecodes]);


  const flattenedOptions = useMemo(() => {
    if (showAddForm) return [];
    const options: { id: string, type: 'create' | 'recent' | 'timecode', tc?: any, search?: string }[] = [];
    if (search && !exactMatch) {
      options.push({ id: 'create-new', type: 'create', search });
    }
    recentTimecodes.forEach(tc => {
      options.push({ id: `recent-${tc.id}`, type: 'recent', tc });
    });
    Array.from(groupedTimecodes.entries()).forEach(([_gId, tcs]) => {
      tcs.forEach(tc => {
        options.push({ id: `tc-${tc.id}`, type: 'timecode', tc });
      });
    });
    return options;
  }, [showAddForm, search, exactMatch, recentTimecodes, groupedTimecodes]);

  useEffect(() => {
    setActiveIndex(search && !exactMatch ? 0 : -1);
  }, [search, exactMatch]);

  const activeId = useMemo(() => flattenedOptions[activeIndex]?.id, [activeIndex, flattenedOptions]);

  useEffect(() => {
    if (activeId) {
      const el = document.getElementById(`option-${activeId}`);
      if (el) {
        el.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [activeId]);


  const handleSelect = (id: string) => {
    onSelect(id);
    setIsOpen(false);
    setSearch('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (isOpen) {
        setIsOpen(false);
        setSearch('');
        setShowAddForm(false);
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }

    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') {
        setIsOpen(true);
        e.preventDefault();
      }
      return;
    }

    if (showAddForm) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(prev => (prev < flattenedOptions.length - 1 ? prev + 1 : prev));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(prev => (prev > 0 ? prev - 1 : prev));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < flattenedOptions.length) {
        const selected = flattenedOptions[activeIndex];
        if (selected.type === 'create') {
          setShowAddForm(true);
        } else if (selected.tc) {
          handleSelect(selected.tc.id);
        }
      }
    }
  };

  const handleCreate = async () => {
    const trimmedSearch = search.trim();
    if (!trimmedSearch) return;

    // Prevent duplicates: case-insensitive match check, but scoped to the same group
    const existingTc = timecodes.find(tc => tc.name.toLowerCase() === trimmedSearch.toLowerCase() && (tc.groupId || '') === (newGroupId || ''));

    if (existingTc) {
      onSelect(existingTc.id);
    } else {
      const rate = newHourlyRate ? parseFloat(newHourlyRate) : undefined;
      const newTc = await addTimecode(trimmedSearch, newColor, newGroupId || undefined, isNaN(rate!) ? undefined : rate);
      onSelect(newTc.id);
    }

    setIsOpen(false);
    setSearch('');
    setShowAddForm(false);
  };

  return (
    <div className="relative w-full max-w-sm" onKeyDown={handleKeyDown}>
      <div
        className="flex items-center justify-between px-3 py-2 bg-stone dark:bg-graphite border border-graphite/10 dark:border-white/10 rounded-md shadow-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 focus-within:ring-2 focus-within:ring-signal focus-within:ring-offset-2 transition-colors"
        onClick={() => !isOpen && setIsOpen(true)}
      >
        <input
          type="text"
          role="combobox"
          aria-expanded={isOpen}
          aria-controls="timecode-listbox"
          aria-activedescendant={activeId ? `option-${activeId}` : undefined}
          className="w-full bg-transparent outline-none cursor-pointer text-graphite dark:text-stone placeholder-gray-500 dark:placeholder-gray-400"
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
        <div className="flex items-center gap-1">
          {selectedTimecode && !isOpen && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSelect('');
                setSearch('');
              }}
              className="p-1 rounded-full text-gray-400 hover:text-graphite dark:text-gray-500 dark:hover:text-stone focus:outline-none transition-colors"
              title="Clear selection"
            >
              <X size={16} />
            </button>
          )}
          <ChevronDown size={18} className="text-gray-400 dark:text-gray-500" />
        </div>
      </div>

      {isOpen && (
        <div id="timecode-listbox" role="listbox" className="absolute z-10 w-full mt-1 bg-stone dark:bg-graphite border border-graphite/10 dark:border-white/10 rounded-md shadow-lg max-h-96 overflow-y-auto">

          {/* Backdrop for click outside */}
          <div className="fixed inset-0 z-[-1]" onClick={() => {
            setIsOpen(false);
            setSearch('');
            setShowAddForm(false);
          }}></div>

          {showAddForm ? (
            <div className="p-4 bg-gray-50 dark:bg-gray-800/30 border-b border-graphite/10 dark:border-white/10">
              <h4 className="text-sm font-medium text-graphite dark:text-stone mb-2">Create New Timecode</h4>

              <div className="mb-3">
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Name</label>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  autoFocus={true}
                  className="w-full text-sm p-1.5 border border-graphite/10 dark:border-white/10 rounded bg-stone dark:bg-graphite text-graphite dark:text-stone focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
                />
              </div>

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
                {creatingGroup ? (
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      autoFocus
                      value={newGroupName}
                      onChange={(e) => setNewGroupName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleCreateGroupInline(); } }}
                      placeholder="New group name"
                      className="flex-1 text-sm p-1.5 border border-graphite/10 dark:border-white/10 rounded bg-stone dark:bg-graphite text-graphite dark:text-stone focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
                    />
                    <button type="button" onClick={handleCreateGroupInline} className="px-2 text-xs bg-graphite hover:bg-ink dark:bg-stone dark:hover:bg-gray-300 text-stone dark:text-ink rounded">Add</button>
                    <button type="button" onClick={() => { setCreatingGroup(false); setNewGroupName(''); }} className="px-2 text-xs text-gray-500">✕</button>
                  </div>
                ) : (
                  <select
                    className="w-full text-sm p-1.5 border border-graphite/10 dark:border-white/10 rounded bg-stone dark:bg-graphite text-graphite dark:text-stone focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
                    value={newGroupId}
                    onChange={(e) => {
                      if (e.target.value === '__new__') { setCreatingGroup(true); }
                      else { setNewGroupId(e.target.value); }
                    }}
                  >
                    <option value="">No Group</option>
                    {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                    <option value="__new__">+ Add New Group…</option>
                  </select>
                )}
              </div>

              <div className="mb-3">
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Hourly Rate (optional)</label>
                <div className="relative">
                  <span className="absolute left-2.5 top-1.5 text-gray-400 dark:text-gray-500">{currencySymbol}</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={newHourlyRate}
                    onChange={(e) => {
                      const val = e.target.value;
                      setNewHourlyRate(val !== '' && Number(val) < 0 ? '0' : val);
                    }}
                    className="w-full text-sm p-1.5 pl-6 border border-graphite/10 dark:border-white/10 rounded bg-stone dark:bg-graphite text-graphite dark:text-stone placeholder-gray-400 dark:placeholder-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowAddForm(false)}
                  className="px-3 py-1.5 text-xs text-graphite dark:text-stone hover:bg-gray-200 dark:hover:bg-gray-800 rounded transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreate}
                  className="px-3 py-1.5 text-xs text-stone dark:text-ink bg-graphite hover:bg-ink dark:bg-stone dark:hover:bg-gray-300 rounded flex items-center gap-1 transition-colors"
                >
                  <Plus size={14} /> Create
                </button>
              </div>
            </div>
          ) : (
            <>
              {search && !exactMatch && (
                <button
                  id="option-create-new"
                  role="option"
                  aria-selected={activeId === 'create-new'}
                  className={`w-full flex items-center gap-2 px-4 py-3 text-left text-signal-dim dark:text-signal border-b border-graphite/10 dark:border-white/10 transition-colors ${activeId === 'create-new' ? 'bg-signal/10' : 'hover:bg-signal/10'}`}
                  onClick={() => setShowAddForm(true)}
                >
                  <Plus size={16} />
                  <span className="font-medium">Create "{search}"</span>
                </button>
              )}

              {filteredTimecodes.length === 0 && !search && (
                <div className="px-4 py-8 text-center text-gray-500 dark:text-gray-400 text-sm">
                  No timecodes yet. Type to create one.
                </div>
              )}


              {recentTimecodes.length > 0 && (
                <div className="py-1 border-b border-graphite/10 dark:border-white/10">
                  <div className="px-3 py-1 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                    Recently Used
                  </div>
                  {recentTimecodes.map(tc => {
                    const group = groups.find(g => g.id === tc.groupId);
                    const color = tc.color || group?.color || '#9ca3af';
                    return (
                      <button
                        key={`recent-${tc.id}`}
                        onClick={() => handleSelect(tc.id)}
                        id={`option-recent-${tc.id}`}
                        role="option"
                        aria-selected={activeId === `recent-${tc.id}`}
                        className={`w-full text-left px-4 py-2 text-sm flex items-center justify-between ${activeId === `recent-${tc.id}` ? 'bg-gray-100 dark:bg-gray-800 text-graphite dark:text-stone' : 'text-graphite dark:text-stone hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                      >
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }}></div>
                          <span>{tc.name}</span>
                          {group && <span className="text-xs text-gray-400 dark:text-gray-500 ml-1">in {group.name}</span>}
                        </div>
                        {selectedId === tc.id && <Check size={16} className="text-signal-dim dark:text-signal" />}
                      </button>
                    );
                  })}
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
                          id={`option-tc-${tc.id}`}
                          role="option"
                          aria-selected={activeId === `tc-${tc.id}`}
                          className={`w-full flex items-center gap-2 px-4 py-2 text-left outline-none transition-colors ${activeId === `tc-${tc.id}` ? 'bg-gray-50 dark:bg-gray-800 text-signal-dim dark:text-signal' : 'text-graphite dark:text-stone hover:bg-gray-50 dark:hover:bg-gray-800 focus:bg-gray-50 dark:focus:bg-gray-800'}`}
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
