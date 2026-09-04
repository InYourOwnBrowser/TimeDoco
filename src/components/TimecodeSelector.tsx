import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useTimeTracker } from '../context/TimeTrackerContext';
import { Plus, Check, ChevronDown, X } from 'lucide-react';
import { useDropdownFit } from '../hooks/useDropdownFit';
import { useOutsideDismiss } from '../hooks/useOutsideDismiss';

const COLORS = ['#ef4444', '#f97316', '#f59e0b', '#10b981', '#0a0a0a', '#8b5cf6', '#ec4899', '#64748b'];

/** As tall as the option list ever gets, when there is room for it. */
const MAX_LIST_HEIGHT = 384;

interface TimecodeSelectorProps {
  onSelect: (timecodeId: string) => void;
  selectedId?: string | null;
  /**
   * Ties the field to the caller's visible label. Every screen this appears on
   * already prints one next to it; without the association the field was
   * announced by its placeholder, and clicking the label did nothing.
   */
  inputId?: string;
}

export const TimecodeSelector: React.FC<TimecodeSelectorProps> = ({ onSelect, selectedId, inputId }) => {
  const { timecodes, groups, addTimecode, addGroup, entries, settings } = useTimeTracker();
  const currencySymbol = settings?.currencySymbol || '$';
  const selectedTimecode = selectedId ? timecodes.find(t => t.id === selectedId) : null;
  const containerRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
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

  // One lookup table instead of a linear scan per row: the list is rebuilt on
  // every keystroke, and every row asked `groups.find` for its own group.
  const groupsById = useMemo(() => new Map(groups.map(g => [g.id, g])), [groups]);

  const unarchivedTimecodes = useMemo(() => {
    return timecodes.filter(t => {
      if (t.archived) return false;
      if (t.groupId) {
        const group = groupsById.get(t.groupId);
        if (group?.archived) return false;
      }
      return true;
    });
  }, [timecodes, groupsById]);

  const filteredTimecodes = useMemo(() => {
    if (!search) return unarchivedTimecodes;
    const needle = search.toLowerCase();
    return unarchivedTimecodes.filter(t => t.name.toLowerCase().includes(needle));
  }, [unarchivedTimecodes, search]);


  const recentTimecodes = useMemo(() => {
    if (search) return [];

    // Three timecodes, from one pass over the entries. Sorting the whole list
    // and parsing every start time twice per comparison is a lot of work to
    // repeat every time this list re-renders, and all but the first three
    // results of it were thrown away.
    const lastUsed = new Map<string, number>();
    for (const entry of entries) {
      const at = new Date(entry.startTime).getTime();
      if (!Number.isFinite(at)) continue;
      const previous = lastUsed.get(entry.timecodeId);
      if (previous === undefined || at > previous) lastUsed.set(entry.timecodeId, at);
    }

    const byId = new Map(unarchivedTimecodes.map(t => [t.id, t]));

    return Array.from(lastUsed.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => byId.get(id))
      .filter((t): t is typeof timecodes[0] => t !== undefined)
      .slice(0, 3);
  }, [entries, unarchivedTimecodes, search]);

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


  const closeDropdown = useCallback(() => {
    setIsOpen(false);
    setSearch('');
    setShowAddForm(false);
  }, []);

  useOutsideDismiss(isOpen, containerRef, closeDropdown);

  const handleSelect = (id: string) => {
    onSelect(id);
    setIsOpen(false);
    setSearch('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (isOpen) {
        closeDropdown();
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

  // The list is sized against the space it actually has — inside a dialog body
  // that is a few hundred pixels, not the 24rem the class alone would ask for —
  // and opens upwards when there is more room there.
  const fit = useDropdownFit(isOpen, anchorRef, listRef, {
    maxHeight: MAX_LIST_HEIGHT,
    contentKey: showAddForm ? 'form' : flattenedOptions.length,
  });

  return (
    <div ref={containerRef} className="relative w-full max-w-sm" onKeyDown={handleKeyDown}>
      <div
        ref={anchorRef}
        className="flex items-center justify-between px-3 py-2 bg-white dark:bg-graphite border border-graphite/20 dark:border-white/20 rounded-md shadow-sm cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800/50 focus-within:ring-2 focus-within:ring-signal focus-within:ring-offset-2 transition-colors"
        onClick={() => !isOpen && setIsOpen(true)}
      >
        <input
          type="text"
          id={inputId}
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
              className="p-1 rounded-full text-gray-500 hover:text-graphite dark:text-gray-400 dark:hover:text-stone focus:outline-none transition-colors"
              title="Clear selection"
            >
              <X size={16} />
            </button>
          )}
          <ChevronDown size={18} className="text-gray-500 dark:text-gray-400" />
        </div>
      </div>

      {isOpen && (
        <div
          id="timecode-listbox"
          role="listbox"
          ref={listRef}
          className={`absolute z-10 w-full bg-white dark:bg-graphite border border-graphite/20 dark:border-white/20 rounded-md shadow-lg max-h-96 overflow-y-auto overscroll-contain ${
            fit.placement === 'top' ? 'bottom-full mb-1' : 'mt-1'
          }`}
          style={fit.maxHeight === null ? undefined : { maxHeight: fit.maxHeight }}
        >
          {showAddForm ? (
            <div className="p-4 bg-stone dark:bg-gray-800/30 border-b border-graphite/20 dark:border-white/20">
              <h4 className="text-sm font-medium text-graphite dark:text-stone mb-2">Create New Timecode</h4>

              <div className="mb-3">
                <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Name</label>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  autoFocus={true}
                  className="w-full text-sm p-1.5 border border-graphite/20 dark:border-white/20 rounded bg-white dark:bg-graphite text-graphite dark:text-stone focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
                />
              </div>

              <div className="mb-3">
                <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Color</label>
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
                <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Group (optional)</label>
                {creatingGroup ? (
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      autoFocus
                      value={newGroupName}
                      onChange={(e) => setNewGroupName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleCreateGroupInline(); } }}
                      placeholder="New group name"
                      className="flex-1 text-sm p-1.5 border border-graphite/20 dark:border-white/20 rounded bg-white dark:bg-graphite text-graphite dark:text-stone focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
                    />
                    <button type="button" onClick={handleCreateGroupInline} className="px-2 text-xs bg-graphite hover:bg-ink dark:bg-stone dark:hover:bg-gray-300 text-stone dark:text-ink rounded">Add</button>
                    <button type="button" onClick={() => { setCreatingGroup(false); setNewGroupName(''); }} className="px-2 text-xs text-gray-600 dark:text-gray-400">✕</button>
                  </div>
                ) : (
                  <select
                    className="w-full text-sm p-1.5 border border-graphite/20 dark:border-white/20 rounded bg-white dark:bg-graphite text-graphite dark:text-stone focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
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
                <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Hourly Rate (optional)</label>
                <div className="relative">
                  <span className="absolute left-2.5 top-1.5 text-gray-500 dark:text-gray-400">{currencySymbol}</span>
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
                    className="w-full text-sm p-1.5 pl-6 border border-graphite/20 dark:border-white/20 rounded bg-white dark:bg-graphite text-graphite dark:text-stone placeholder-gray-500 dark:placeholder-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
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
                  className={`w-full flex items-center gap-2 px-4 py-3 text-left text-signal-dim dark:text-signal border-b border-graphite/20 dark:border-white/20 transition-colors ${activeId === 'create-new' ? 'bg-signal/10' : 'hover:bg-signal/10'}`}
                  onClick={() => setShowAddForm(true)}
                >
                  <Plus size={16} />
                  <span className="font-medium">Create "{search}"</span>
                </button>
              )}

              {filteredTimecodes.length === 0 && !search && (
                <div className="px-4 py-8 text-center text-gray-600 dark:text-gray-400 text-sm">
                  No timecodes yet. Type to create one.
                </div>
              )}


              {recentTimecodes.length > 0 && (
                <div className="py-1 border-b border-graphite/20 dark:border-white/20">
                  <div className="px-3 py-1 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                    Recently Used
                  </div>
                  {recentTimecodes.map(tc => {
                    const group = tc.groupId ? groupsById.get(tc.groupId) : undefined;
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
                          {group && <span className="text-xs text-gray-500 dark:text-gray-400 ml-1">in {group.name}</span>}
                        </div>
                        {selectedId === tc.id && <Check size={16} className="text-signal-dim dark:text-signal" />}
                      </button>
                    );
                  })}
                </div>
              )}
              {Array.from(groupedTimecodes.entries()).map(([gId, tcs]) => {
                const group = gId ? groupsById.get(gId) : undefined;
                return (
                  <div key={gId || 'ungrouped'} className="py-1">
                    {group && (
                      <div className="px-3 py-1 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
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
                          className={`w-full flex items-center gap-2 px-4 py-2 text-left outline-none transition-colors ${activeId === `tc-${tc.id}` ? 'bg-gray-100 dark:bg-gray-800 text-signal-dim dark:text-signal' : 'text-graphite dark:text-stone hover:bg-gray-100 dark:hover:bg-gray-800 focus:bg-gray-100 dark:focus:bg-gray-800'}`}
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
