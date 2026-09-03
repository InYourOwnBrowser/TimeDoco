import React, { useState, useMemo } from 'react';
import { useTimeTracker } from '../context/TimeTrackerContext';
import { useToast } from '../context/ToastContext';
import {
  ChevronDown,
  ChevronRight,
  Search,
  Plus,
  Edit2,
  Archive,
  ArchiveRestore,
  Check,
  X,
  Trash2,
  Merge,
  MoreVertical,
} from 'lucide-react';
import type { Group, Timecode } from '../types';
import { HelpTooltip } from './ui/HelpTooltip';
import { describeUserFacingError } from '../utils/errorMessage';

export const GroupingManagement: React.FC = () => {
  const {
    groups,
    timecodes,
    deletedGroups,
    deletedTimecodes,
    entries,
    addGroup,
    updateGroup,
    deleteGroup,
    addTimecode,
    updateTimecode,
    deleteTimecode,
    mergeTimecodes,
    settings,
  } = useTimeTracker();

  const currencySymbol = settings?.currencySymbol || '$';
  const { addToast } = useToast();

  /**
   * A name is taken if anything already carries it — including a record in the
   * trash.
   *
   * CSV import resolves each row's timecode against live and trashed records
   * alike, so a name that exists in both places makes every row naming it
   * ambiguous and stops the whole import (see SettingsModal). Restoring a
   * trashed timecode into a name that has since been reused produces the same
   * pair from the other direction. Neither is something the user can see coming
   * from this screen, so refuse the collision here and say where the other one
   * is.
   */
  const takenBy = <T extends { id: string; name: string; deletedAt?: string }>(
    candidates: T[],
    name: string,
    exceptId?: string,
  ): T | undefined =>
    candidates.find(c => c.id !== exceptId && c.name.trim().toLowerCase() === name.trim().toLowerCase());

  const nameClashMessage = (clash: { deletedAt?: string }, kind: 'group' | 'timecode', where = '') =>
    clash.deletedAt
      ? `A ${kind} with this name is in the trash${where}. Restore it to use it, or empty the trash to free the name.`
      : `A ${kind} with this name already exists${where}.`;

  // Search filter
  const [searchQuery, setSearchQuery] = useState('');

  // Group collapsed state (default: all expanded)
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(new Set());

  // Show archived items section disclosure
  const [showArchived, setShowArchived] = useState(false);

  // New Group modal/inline form state
  const [isAddingGroup, setIsAddingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupColor, setNewGroupColor] = useState('#3E7368');

  // Editing group state
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupData, setEditingGroupData] = useState<{ name: string; color: string }>({ name: '', color: '' });

  // Adding timecode per group state (holds the group ID being added to, or 'NO_GROUP')
  const [addingTimecodeGroupId, setAddingTimecodeGroupId] = useState<string | null>(null);
  const [newTimecodeName, setNewTimecodeName] = useState('');
  const [newTimecodeColor, setNewTimecodeColor] = useState('#3E7368');
  const [newTimecodeRate, setNewTimecodeRate] = useState('');

  // Editing timecode state
  const [editingTimecodeId, setEditingTimecodeId] = useState<string | null>(null);
  const [editingTimecodeData, setEditingTimecodeData] = useState<{
    name: string;
    color: string;
    groupId: string;
    hourlyRate: string;
  }>({ name: '', color: '', groupId: '', hourlyRate: '' });

  // Merging timecode state
  const [mergingTimecodeId, setMergingTimecodeId] = useState<string | null>(null);
  const [mergeDestId, setMergeDestId] = useState<string>('');

  // Mobile overflow menu state
  const [mobileMenuId, setMobileMenuId] = useState<string | null>(null);

  // Calculate entry usage count for each timecode
  const entryCountMap = useMemo(() => {
    const map = new Map<string, number>();
    entries.forEach((e) => {
      if (e.timecodeId && !e.deletedAt) {
        map.set(e.timecodeId, (map.get(e.timecodeId) || 0) + 1);
      }
    });
    return map;
  }, [entries]);

  // Group expand / collapse toggle
  const toggleGroupCollapse = (groupId: string) => {
    setCollapsedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  // Group Handlers
  const handleEditGroupStart = (group: Group) => {
    setEditingGroupId(group.id);
    setEditingGroupData({ name: group.name, color: group.color });
    setMobileMenuId(null);
  };

  const handleEditGroupSave = async (id: string) => {
    const trimmedName = editingGroupData.name.trim();
    if (!trimmedName) return;

    const groupClash = takenBy([...groups, ...deletedGroups], trimmedName, id);
    if (groupClash) {
      addToast(nameClashMessage(groupClash, 'group'), 'error');
      return;
    }

    if (await updateGroup(id, { name: trimmedName, color: editingGroupData.color })) {
      setEditingGroupId(null);
    }
  };

  const handleCreateGroup = async () => {
    const trimmedName = newGroupName.trim();
    if (!trimmedName) return;

    const groupClash = takenBy([...groups, ...deletedGroups], trimmedName);
    if (groupClash) {
      addToast(nameClashMessage(groupClash, 'group'), 'error');
      return;
    }

    // addGroup reports a failed write and rethrows, so the record is never
    // handed back unstored. Catching here keeps the add form open with what the
    // user typed instead of clearing it as though the group had been created.
    try {
      await addGroup(trimmedName, newGroupColor);
    } catch {
      return;
    }
    setNewGroupName('');
    setNewGroupColor('#3E7368');
    setIsAddingGroup(false);
  };

  // Timecode Handlers
  const handleEditTimecodeStart = (tc: Timecode) => {
    setEditingTimecodeId(tc.id);
    setEditingTimecodeData({
      name: tc.name,
      color: tc.color || '',
      groupId: tc.groupId || '',
      hourlyRate: tc.hourlyRate ? tc.hourlyRate.toString() : '',
    });
    setMergingTimecodeId(null);
    setMobileMenuId(null);
  };

  const handleEditTimecodeSave = async (id: string) => {
    const trimmedName = editingTimecodeData.name.trim();
    if (!trimmedName) return;

    const targetGroupId = editingTimecodeData.groupId || null;

    const timecodeClash = takenBy(
      [...timecodes, ...deletedTimecodes].filter((t) => (t.groupId || null) === targetGroupId),
      trimmedName,
      id,
    );
    if (timecodeClash) {
      addToast(nameClashMessage(timecodeClash, 'timecode', ' in the selected group'), 'error');
      return;
    }

    const parsedRate = parseFloat(editingTimecodeData.hourlyRate);
    if (await updateTimecode(id, {
      name: trimmedName,
      color: editingTimecodeData.color || undefined,
      groupId: targetGroupId,
      // `Number.isFinite` rather than `isNaN`: "1e999" parses to Infinity, which
      // is not NaN and is not <= 0, so it was stored as a rate — and then every
      // amount computed from it came out of `roundCurrency` as a silent 0. The
      // backup importer has always applied this rule; the editor had not.
      hourlyRate: Number.isFinite(parsedRate) && parsedRate > 0 ? parsedRate : null,
    })) {
      setEditingTimecodeId(null);
    }
  };

  const handleStartAddingTimecode = (groupId: string | null) => {
    const targetGroupId = groupId || 'NO_GROUP';
    setAddingTimecodeGroupId(targetGroupId);
    // Inherit group color if available
    const parentGroup = groups.find((g) => g.id === groupId);
    setNewTimecodeColor(parentGroup ? parentGroup.color : '#3E7368');
    setNewTimecodeName('');
    setNewTimecodeRate('');
  };

  const handleCreateTimecode = async (groupId: string | null) => {
    const trimmedName = newTimecodeName.trim();
    if (!trimmedName) return;

    const timecodeClash = takenBy(
      [...timecodes, ...deletedTimecodes].filter((t) => (t.groupId || null) === (groupId || null)),
      trimmedName,
    );
    if (timecodeClash) {
      addToast(nameClashMessage(timecodeClash, 'timecode', ' in the selected group'), 'error');
      return;
    }

    const parsedRate = parseFloat(newTimecodeRate);
    // As with handleCreateGroup: a failed write is already reported, and the
    // form keeps what was typed rather than resetting as though it had saved.
    try {
      await addTimecode(
        trimmedName,
        newTimecodeColor,
        groupId || undefined,
        isNaN(parsedRate) || parsedRate <= 0 ? undefined : parsedRate
      );
    } catch {
      return;
    }
    setNewTimecodeName('');
    setNewTimecodeRate('');
    setAddingTimecodeGroupId(null);
  };

  const handleMergeSave = async (sourceId: string) => {
    if (!mergeDestId || mergeDestId === sourceId) return;

    const sourceTc = timecodes.find((t) => t.id === sourceId);
    const destTc = timecodes.find((t) => t.id === mergeDestId);
    const sourceRate = sourceTc?.hourlyRate ?? null;
    const destRate = destTc?.hourlyRate ?? null;

    const ratesDiffer = (sourceRate ?? 0) !== (destRate ?? 0);
    const movedEntriesCount = entries.filter((e) => e.timecodeId === sourceId && !e.deletedAt).length;

    const sourceRateStr = `${currencySymbol}${(sourceRate ?? 0).toFixed(2)}/hr`;
    const destRateStr = `${currencySymbol}${(destRate ?? 0).toFixed(2)}/hr`;
    const rateNotice = ratesDiffer
      ? `${movedEntriesCount} ${movedEntriesCount === 1 ? 'entry' : 'entries'} currently billed at ${sourceRateStr} will move to a timecode billed at ${destRateStr}. `
      : '';

    const confirmMsg = `Are you sure you want to merge these timecodes? All entries from the source will be moved to the destination. ${rateNotice}The source timecode moves to the trash; restoring it will not bring the entries back.`;

    if (window.confirm(confirmMsg)) {
      // mergeTimecodes rejects a merge that would leave two running timers or
      // produce overlapping entries. Unhandled, that reached the user as an
      // unhandled rejection and a panel stuck open, with nothing to say whether
      // the merge had happened. Its messages are already written for the user.
      try {
        const ok = await mergeTimecodes(sourceId, mergeDestId);
        if (ok) {
          addToast('Timecodes merged.', 'success');
        }
      } catch (error) {
        // Was `error.message` raw for any Error, so a TypeError thrown under
        // `mergeTimecodes` reached the user verbatim. Its refusals are plain
        // Errors written for the user and still come through unchanged.
        addToast(describeUserFacingError(error, 'merge these timecodes'), 'error');
      } finally {
        setMergingTimecodeId(null);
        setMergeDestId('');
      }
    }
  };

  // Filtered lists based on search and archive disclosure
  const q = searchQuery.toLowerCase().trim();
  const isSearching = q.length > 0;
  const revealArchived = showArchived || isSearching;

  // Active vs Archived Groups
  const activeGroups = groups.filter((g) => !g.archived);
  const archivedGroups = groups.filter((g) => g.archived);

  // Filter groups matching search query
  const matchesGroupOrTimecodes = (group: Group) => {
    if (!isSearching) return true;
    if (group.name.toLowerCase().includes(q)) return true;
    return timecodes.some(
      (tc) => (tc.groupId || null) === group.id && tc.name.toLowerCase().includes(q)
    );
  };

  const visibleActiveGroups = activeGroups.filter(matchesGroupOrTimecodes);
  const visibleArchivedGroups = archivedGroups.filter(matchesGroupOrTimecodes);

  // Unassigned / No Group timecodes
  const noGroupTimecodes = timecodes.filter((tc) => !tc.groupId);
  const activeNoGroupTimecodes = noGroupTimecodes.filter((tc) => !tc.archived);
  const archivedNoGroupTimecodes = noGroupTimecodes.filter((tc) => tc.archived);

  const matchesNoGroup = (tc: Timecode) => {
    if (!isSearching) return true;
    return tc.name.toLowerCase().includes(q);
  };

  const visibleActiveNoGroupTimecodes = activeNoGroupTimecodes.filter(matchesNoGroup);
  const visibleArchivedNoGroupTimecodes = archivedNoGroupTimecodes.filter(matchesNoGroup);

  // Total archived items count for disclosure badge
  const totalArchivedCount =
    archivedGroups.length + timecodes.filter((tc) => tc.archived && tc.groupId).length + archivedNoGroupTimecodes.length;

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6">
      {/* Top Header Card & Search Bar */}
      <div className="bg-white dark:bg-graphite p-6 rounded-panel shadow-sm border border-graphite/20 dark:border-white/20 transition-colors">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-graphite/20 dark:border-white/20">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-graphite dark:text-stone flex items-center gap-2">
              Groups & Timecodes
              <HelpTooltip text="Timecodes are what you actually track time against (e.g. 'Client A - Design'). Groups are used to organize timecodes by client or project." />
            </h1>
            <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mt-1">
              Manage your categories, timecodes, rates, and visual groupings.
            </p>
          </div>

          {!isAddingGroup && (
            <button
              onClick={() => setIsAddingGroup(true)}
              className="px-4 py-2 bg-signal hover:bg-signal-dim text-ink font-semibold text-sm rounded-lg shadow-sm transition-colors flex items-center justify-center gap-1.5 shrink-0 focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 ring-offset-stone dark:ring-offset-graphite"
            >
              <Plus size={16} /> New Group
            </button>
          )}
        </div>

        {/* New Group Inline Creation Panel */}
        {isAddingGroup && (
          <div className="mt-4 p-4 bg-stone/50 dark:bg-ink/40 rounded-panel border border-graphite/20 dark:border-white/20 space-y-3">
            <h3 className="text-sm font-semibold text-graphite dark:text-stone">Create New Group</h3>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={newGroupColor}
                  onChange={(e) => setNewGroupColor(e.target.value)}
                  className="w-9 h-9 rounded cursor-pointer border-0 p-0 shrink-0"
                  title="Group Color"
                />
                <input
                  type="text"
                  value={newGroupColor}
                  onChange={(e) => setNewGroupColor(e.target.value)}
                  className="w-24 px-2 py-1.5 text-sm border border-graphite/20 dark:border-white/20 rounded bg-white dark:bg-graphite text-graphite dark:text-stone outline-none focus-visible:ring-2 focus-visible:ring-signal font-mono"
                  placeholder="#HEX"
                />
              </div>
              <input
                type="text"
                placeholder="Group Name (e.g. Client A, Internal)"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                className="flex-1 px-3 py-1.5 border border-graphite/20 dark:border-white/20 rounded outline-none focus-visible:ring-2 focus-visible:ring-signal text-sm bg-white dark:bg-graphite text-graphite dark:text-stone placeholder-gray-500 dark:placeholder-gray-400"
                autoFocus
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCreateGroup}
                  disabled={!newGroupName.trim()}
                  className="px-4 py-1.5 bg-signal hover:bg-signal-dim text-ink text-sm font-semibold rounded disabled:opacity-50 transition-colors flex items-center justify-center gap-1"
                >
                  <Check size={16} /> Save Group
                </button>
                <button
                  onClick={() => {
                    setIsAddingGroup(false);
                    setNewGroupName('');
                  }}
                  className="px-3 py-1.5 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-800 text-sm font-medium rounded transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Search Bar */}
        <div className="mt-4 relative">
          <Search size={18} className="absolute left-3 top-2.5 text-gray-400 dark:text-gray-500 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search groups & timecodes…"
            className="w-full pl-9 pr-9 py-2 border border-graphite/20 dark:border-white/20 rounded-lg bg-stone/30 dark:bg-ink/30 text-graphite dark:text-stone placeholder-gray-500 dark:placeholder-gray-400 text-sm outline-none focus-visible:ring-2 focus-visible:ring-signal"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600 dark:hover:text-stone"
              aria-label="Clear Search"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Main Group & Timecode List */}
      <div className="space-y-4">
        {/* Active Groups */}
        {visibleActiveGroups.map((group) => {
          const isCollapsed = !isSearching && collapsedGroupIds.has(group.id);
          const groupTimecodes = timecodes.filter((tc) => (tc.groupId || null) === group.id);
          const activeGroupTimecodes = groupTimecodes.filter((tc) => !tc.archived);
          const archivedGroupTimecodes = groupTimecodes.filter((tc) => tc.archived);

          const visibleActiveTc = activeGroupTimecodes.filter((tc) =>
            isSearching ? tc.name.toLowerCase().includes(q) || group.name.toLowerCase().includes(q) : true
          );

          const visibleArchivedTc = archivedGroupTimecodes.filter((tc) =>
            isSearching ? tc.name.toLowerCase().includes(q) || group.name.toLowerCase().includes(q) : true
          );

          return (
            <div
              key={group.id}
              className="bg-white dark:bg-graphite rounded-panel shadow-sm border border-graphite/20 dark:border-white/20 overflow-hidden transition-colors"
            >
              {/* Group Header */}
              <div
                className="border-l-4 p-4 flex items-center justify-between gap-3 bg-stone/20 dark:bg-ink/20 transition-colors"
                style={{ borderLeftColor: group.color || '#3E7368' }}
              >
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <button
                    onClick={() => toggleGroupCollapse(group.id)}
                    className="p-1 hover:bg-stone dark:hover:bg-graphite/80 rounded transition-colors text-gray-600 dark:text-gray-400 shrink-0"
                    aria-label={isCollapsed ? `Expand ${group.name}` : `Collapse ${group.name}`}
                  >
                    {isCollapsed ? <ChevronRight size={20} /> : <ChevronDown size={20} />}
                  </button>

                  <div className="w-3.5 h-3.5 rounded-full shrink-0" style={{ backgroundColor: group.color }} />

                  <span className="font-bold text-base sm:text-lg text-graphite dark:text-stone truncate">
                    {group.name}
                  </span>

                  <span className="text-xs font-normal text-gray-600 dark:text-gray-400 shrink-0">
                    ({groupTimecodes.length} {groupTimecodes.length === 1 ? 'timecode' : 'timecodes'})
                  </span>
                </div>

                {/* Group Action Buttons (Desktop) */}
                <div className="hidden sm:flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => handleEditGroupStart(group)}
                    className="p-2 text-gray-600 dark:text-gray-400 hover:text-signal-dim dark:hover:text-signal hover:bg-signal/10 rounded-md transition-colors"
                    title="Edit Group"
                    aria-label="Edit Group"
                  >
                    <Edit2 size={16} />
                  </button>
                  <button
                    onClick={async () => await updateGroup(group.id, { archived: true })}
                    className="p-2 text-gray-600 dark:text-gray-400 hover:text-signal-dim dark:hover:text-signal hover:bg-signal/10 rounded-md transition-colors"
                    title="Archive Group"
                    aria-label="Archive Group"
                  >
                    <Archive size={16} />
                  </button>
                  <button
                    onClick={async () => {
                      if (
                        window.confirm(
                          `Delete "${group.name}" and all its timecodes/entries? This can be undone from the toast or Trash.`
                        )
                      ) {
                        await deleteGroup(group.id);
                      }
                    }}
                    className="p-2 text-gray-600 dark:text-gray-400 hover:text-rust dark:hover:text-rust hover:bg-rust/10 rounded-md transition-colors"
                    title="Delete Group (Move to Trash)"
                    aria-label="Delete Group"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>

                {/* Group Action Menu (Mobile Overflow) */}
                <div className="sm:hidden relative shrink-0">
                  <button
                    onClick={() => setMobileMenuId(mobileMenuId === group.id ? null : group.id)}
                    className="p-2 text-gray-600 dark:text-gray-400 hover:bg-stone dark:hover:bg-graphite/80 rounded-md transition-colors"
                    aria-label="Group Actions Menu"
                  >
                    <MoreVertical size={18} />
                  </button>
                  {mobileMenuId === group.id && (
                    <div className="absolute right-0 top-full mt-1 z-20 w-36 bg-white dark:bg-graphite border border-graphite/20 dark:border-white/20 rounded-md shadow-lg p-1 flex flex-col gap-0.5 text-xs">
                      <button
                        onClick={() => handleEditGroupStart(group)}
                        className="w-full text-left px-2 py-1.5 text-graphite dark:text-stone hover:bg-stone/50 dark:hover:bg-ink/50 rounded flex items-center gap-2"
                      >
                        <Edit2 size={14} /> Edit
                      </button>
                      <button
                        onClick={async () => {
                          if (await updateGroup(group.id, { archived: true })) {
                            setMobileMenuId(null);
                          }
                        }}
                        className="w-full text-left px-2 py-1.5 text-graphite dark:text-stone hover:bg-stone/50 dark:hover:bg-ink/50 rounded flex items-center gap-2"
                      >
                        <Archive size={14} /> Archive
                      </button>
                      <button
                        onClick={async () => {
                          setMobileMenuId(null);
                          if (
                            window.confirm(
                              `Delete "${group.name}" and all its timecodes/entries? This can be undone from the toast or Trash.`
                            )
                          ) {
                            await deleteGroup(group.id);
                          }
                        }}
                        className="w-full text-left px-2 py-1.5 text-rust dark:text-rust hover:bg-rust/10 rounded flex items-center gap-2"
                      >
                        <Trash2 size={14} /> Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Group Edit Panel */}
              {editingGroupId === group.id && (
                <div className="p-4 bg-stone/50 dark:bg-ink/40 border-b border-graphite/20 dark:border-white/20 flex flex-wrap items-center gap-3 text-sm">
                  <div className="flex items-center gap-2 shrink-0">
                    <input
                      type="color"
                      value={editingGroupData.color}
                      onChange={(e) => setEditingGroupData({ ...editingGroupData, color: e.target.value })}
                      className="w-8 h-8 rounded cursor-pointer border-0 p-0 shrink-0"
                    />
                    <input
                      type="text"
                      value={editingGroupData.color}
                      onChange={(e) => setEditingGroupData({ ...editingGroupData, color: e.target.value })}
                      className="w-20 px-2 py-1 border border-graphite/20 dark:border-white/20 rounded bg-white dark:bg-graphite text-graphite dark:text-stone outline-none focus-visible:ring-2 focus-visible:ring-signal font-mono text-xs"
                      placeholder="#HEX"
                    />
                  </div>
                  <input
                    type="text"
                    value={editingGroupData.name}
                    onChange={(e) => setEditingGroupData({ ...editingGroupData, name: e.target.value })}
                    className="flex-1 min-w-[150px] px-3 py-1.5 border border-graphite/20 dark:border-white/20 rounded outline-none focus-visible:ring-2 focus-visible:ring-signal bg-white dark:bg-graphite text-graphite dark:text-stone"
                    autoFocus
                  />
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleEditGroupSave(group.id)}
                      className="px-3 py-1.5 bg-signal hover:bg-signal-dim text-ink text-sm font-semibold rounded transition-colors flex items-center gap-1"
                    >
                      <Check size={16} /> Save
                    </button>
                    <button
                      onClick={() => setEditingGroupId(null)}
                      className="px-3 py-1.5 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-800 text-sm font-medium rounded transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Group Body: Nested Timecodes */}
              {!isCollapsed && (
                <div className="p-4 space-y-2">
                  {visibleActiveTc.map((tc) =>
                    renderTimecodeRow({
                      tc,
                      groupColor: group.color,
                      entryCount: entryCountMap.get(tc.id) || 0,
                      editingTimecodeId,
                      editingTimecodeData,
                      setEditingTimecodeData,
                      handleEditTimecodeStart,
                      handleEditTimecodeSave,
                      setEditingTimecodeId,
                      mergingTimecodeId,
                      setMergingTimecodeId,
                      mergeDestId,
                      setMergeDestId,
                      handleMergeSave,
                      updateTimecode,
                      deleteTimecode,
                      mobileMenuId,
                      setMobileMenuId,
                      groups: activeGroups,
                      timecodes,
                      currencySymbol,
                    })
                  )}

                  {/* Archived Timecodes within active group */}
                  {revealArchived &&
                    visibleArchivedTc.map((tc) =>
                      renderTimecodeRow({
                        tc,
                        groupColor: group.color,
                        entryCount: entryCountMap.get(tc.id) || 0,
                        editingTimecodeId,
                        editingTimecodeData,
                        setEditingTimecodeData,
                        handleEditTimecodeStart,
                        handleEditTimecodeSave,
                        setEditingTimecodeId,
                        mergingTimecodeId,
                        setMergingTimecodeId,
                        mergeDestId,
                        setMergeDestId,
                        handleMergeSave,
                        updateTimecode,
                        deleteTimecode,
                        mobileMenuId,
                        setMobileMenuId,
                        groups: activeGroups,
                        timecodes,
                        currencySymbol,
                        isArchivedRow: true,
                      })
                    )}

                  {visibleActiveTc.length === 0 && (!revealArchived || visibleArchivedTc.length === 0) && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 italic py-1">
                      No timecodes in this group yet.
                    </p>
                  )}

                  {/* Contextual "+ Add timecode to Group" */}
                  {addingTimecodeGroupId === group.id ? (
                    renderAddTimecodeForm({
                      groupId: group.id,
                      newTimecodeName,
                      setNewTimecodeName,
                      newTimecodeColor,
                      setNewTimecodeColor,
                      newTimecodeRate,
                      setNewTimecodeRate,
                      handleCreateTimecode,
                      setAddingTimecodeGroupId,
                      currencySymbol,
                    })
                  ) : (
                    <button
                      onClick={() => handleStartAddingTimecode(group.id)}
                      className="mt-2 text-xs font-semibold text-signal-dim dark:text-signal hover:underline flex items-center gap-1 pt-1"
                    >
                      <Plus size={14} /> Add timecode to {group.name}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Permanent "No Group" Bucket */}
        {(!isSearching || visibleActiveNoGroupTimecodes.length > 0 || (revealArchived && visibleArchivedNoGroupTimecodes.length > 0)) && (
          <div className="bg-white dark:bg-graphite rounded-panel shadow-sm border border-graphite/20 dark:border-white/20 overflow-hidden transition-colors">
            <div className="border-l-4 border-gray-400 dark:border-gray-600 p-4 flex items-center justify-between gap-3 bg-stone/20 dark:bg-ink/20">
              <div className="flex items-center gap-2.5">
                <button
                  onClick={() => toggleGroupCollapse('NO_GROUP')}
                  className="p-1 hover:bg-stone dark:hover:bg-graphite/80 rounded transition-colors text-gray-600 dark:text-gray-400 shrink-0"
                  aria-label="Toggle No Group section"
                >
                  {!isSearching && collapsedGroupIds.has('NO_GROUP') ? (
                    <ChevronRight size={20} />
                  ) : (
                    <ChevronDown size={20} />
                  )}
                </button>
                <span className="font-bold text-base sm:text-lg text-graphite dark:text-stone">No Group</span>
                <span className="text-xs font-normal text-gray-600 dark:text-gray-400">
                  ({noGroupTimecodes.length} {noGroupTimecodes.length === 1 ? 'timecode' : 'timecodes'})
                </span>
              </div>
            </div>

            {(isSearching || !collapsedGroupIds.has('NO_GROUP')) && (
              <div className="p-4 space-y-2">
                {visibleActiveNoGroupTimecodes.map((tc) =>
                  renderTimecodeRow({
                    tc,
                    groupColor: '#cbd5e1',
                    entryCount: entryCountMap.get(tc.id) || 0,
                    editingTimecodeId,
                    editingTimecodeData,
                    setEditingTimecodeData,
                    handleEditTimecodeStart,
                    handleEditTimecodeSave,
                    setEditingTimecodeId,
                    mergingTimecodeId,
                    setMergingTimecodeId,
                    mergeDestId,
                    setMergeDestId,
                    handleMergeSave,
                    updateTimecode,
                    deleteTimecode,
                    mobileMenuId,
                    setMobileMenuId,
                    groups: activeGroups,
                    timecodes,
                    currencySymbol,
                  })
                )}

                {revealArchived &&
                  visibleArchivedNoGroupTimecodes.map((tc) =>
                    renderTimecodeRow({
                      tc,
                      groupColor: '#cbd5e1',
                      entryCount: entryCountMap.get(tc.id) || 0,
                      editingTimecodeId,
                      editingTimecodeData,
                      setEditingTimecodeData,
                      handleEditTimecodeStart,
                      handleEditTimecodeSave,
                      setEditingTimecodeId,
                      mergingTimecodeId,
                      setMergingTimecodeId,
                      mergeDestId,
                      setMergeDestId,
                      handleMergeSave,
                      updateTimecode,
                      deleteTimecode,
                      mobileMenuId,
                      setMobileMenuId,
                      groups: activeGroups,
                      timecodes,
                      currencySymbol,
                      isArchivedRow: true,
                    })
                  )}

                {visibleActiveNoGroupTimecodes.length === 0 &&
                  (!revealArchived || visibleArchivedNoGroupTimecodes.length === 0) && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 italic py-1">
                      No unassigned timecodes.
                    </p>
                  )}

                {addingTimecodeGroupId === 'NO_GROUP' ? (
                  renderAddTimecodeForm({
                    groupId: null,
                    newTimecodeName,
                    setNewTimecodeName,
                    newTimecodeColor,
                    setNewTimecodeColor,
                    newTimecodeRate,
                    setNewTimecodeRate,
                    handleCreateTimecode,
                    setAddingTimecodeGroupId,
                    currencySymbol,
                  })
                ) : (
                  <button
                    onClick={() => handleStartAddingTimecode(null)}
                    className="mt-2 text-xs font-semibold text-signal-dim dark:text-signal hover:underline flex items-center gap-1 pt-1"
                  >
                    <Plus size={14} /> Add timecode (No Group)
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Archived Groups Section (when revealed) */}
        {revealArchived && visibleArchivedGroups.length > 0 && (
          <div className="space-y-4 pt-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 px-1">
              Archived Groups
            </h3>
            {visibleArchivedGroups.map((group) => {
              const groupTimecodes = timecodes.filter((tc) => (tc.groupId || null) === group.id);
              return (
                <div
                  key={group.id}
                  className="bg-white/60 dark:bg-graphite/60 rounded-panel border border-graphite/20 dark:border-white/20 overflow-hidden opacity-75"
                >
                  <div
                    className="border-l-4 p-4 flex items-center justify-between gap-3 bg-stone/20 dark:bg-ink/20"
                    style={{ borderLeftColor: group.color || '#3E7368' }}
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <div className="w-3.5 h-3.5 rounded-full shrink-0" style={{ backgroundColor: group.color }} />
                      <span className="font-bold text-base text-graphite dark:text-stone truncate">{group.name}</span>
                      <span className="text-xs bg-stone dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-2 py-0.5 rounded">
                        Archived Group
                      </span>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={async () => await updateGroup(group.id, { archived: false })}
                        className="p-2 text-verdigris dark:text-emerald-400 hover:bg-verdigris/10 rounded-md transition-colors"
                        title="Restore Group"
                        aria-label="Restore Group"
                      >
                        <ArchiveRestore size={16} />
                      </button>
                      <button
                        onClick={async () => {
                          if (
                            window.confirm(
                              `Delete "${group.name}" and all its timecodes/entries? This can be undone from the toast or Trash.`
                            )
                          ) {
                            await deleteGroup(group.id);
                          }
                        }}
                        className="p-2 text-gray-600 dark:text-gray-400 hover:text-rust dark:hover:text-rust hover:bg-rust/10 rounded-md transition-colors"
                        title="Delete Group"
                        aria-label="Delete Group"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>

                  <div className="p-4 space-y-2">
                    {groupTimecodes.map((tc) =>
                      renderTimecodeRow({
                        tc,
                        groupColor: group.color,
                        entryCount: entryCountMap.get(tc.id) || 0,
                        editingTimecodeId,
                        editingTimecodeData,
                        setEditingTimecodeData,
                        handleEditTimecodeStart,
                        handleEditTimecodeSave,
                        setEditingTimecodeId,
                        mergingTimecodeId,
                        setMergingTimecodeId,
                        mergeDestId,
                        setMergeDestId,
                        handleMergeSave,
                        updateTimecode,
                        deleteTimecode,
                        mobileMenuId,
                        setMobileMenuId,
                        groups: activeGroups,
                        timecodes,
                        currencySymbol,
                        isArchivedRow: true,
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Disclosure Toggle for Archived Items */}
        {!isSearching && totalArchivedCount > 0 && (
          <div className="pt-2 flex justify-center">
            <button
              onClick={() => setShowArchived(!showArchived)}
              className="text-xs font-semibold text-gray-600 dark:text-gray-400 hover:text-graphite dark:hover:text-stone px-4 py-2 rounded-lg bg-stone/50 dark:bg-graphite/50 border border-graphite/10 dark:border-white/10 transition-colors flex items-center gap-1.5"
            >
              {showArchived ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              {showArchived ? 'Hide archived items' : `Show ${totalArchivedCount} archived ${totalArchivedCount === 1 ? 'item' : 'items'}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

/* Helper Component / Renderer for a single Timecode Row */
interface RenderTimecodeRowProps {
  tc: Timecode;
  groupColor: string;
  entryCount: number;
  editingTimecodeId: string | null;
  editingTimecodeData: { name: string; color: string; groupId: string; hourlyRate: string };
  setEditingTimecodeData: (data: { name: string; color: string; groupId: string; hourlyRate: string }) => void;
  handleEditTimecodeStart: (tc: Timecode) => void;
  handleEditTimecodeSave: (id: string) => void;
  setEditingTimecodeId: (id: string | null) => void;
  mergingTimecodeId: string | null;
  setMergingTimecodeId: (id: string | null) => void;
  mergeDestId: string;
  setMergeDestId: (id: string) => void;
  handleMergeSave: (sourceId: string) => void;
  updateTimecode: (id: string, updates: Partial<Timecode>) => Promise<boolean>;
  deleteTimecode: (id: string) => Promise<boolean>;
  mobileMenuId: string | null;
  setMobileMenuId: (id: string | null) => void;
  groups: Group[];
  timecodes: Timecode[];
  currencySymbol: string;
  isArchivedRow?: boolean;
}

function renderTimecodeRow({
  tc,
  groupColor,
  entryCount,
  editingTimecodeId,
  editingTimecodeData,
  setEditingTimecodeData,
  handleEditTimecodeStart,
  handleEditTimecodeSave,
  setEditingTimecodeId,
  mergingTimecodeId,
  setMergingTimecodeId,
  mergeDestId,
  setMergeDestId,
  handleMergeSave,
  updateTimecode,
  deleteTimecode,
  mobileMenuId,
  setMobileMenuId,
  groups,
  timecodes,
  currencySymbol,
  isArchivedRow,
}: RenderTimecodeRowProps) {
  const isEditing = editingTimecodeId === tc.id;
  const isMerging = mergingTimecodeId === tc.id;

  const displayColor = tc.color || groupColor || '#cbd5e1';

  const formatRate = (rate?: number | null) => {
    if (rate == null || isNaN(rate) || rate <= 0) return '—';
    const formatted = Number.isInteger(rate) ? rate.toString() : rate.toFixed(2);
    return `${currencySymbol}${formatted}/hr`;
  };

  return (
    <div
      key={tc.id}
      className={`rounded-lg border border-graphite/10 dark:border-white/10 p-3 bg-stone/40 dark:bg-ink/30 transition-colors ${
        isArchivedRow || tc.archived ? 'opacity-60' : ''
      }`}
    >
      {/* Read-Only Row view */}
      {!isEditing && !isMerging && (
        <div className="flex items-center justify-between gap-3 flex-wrap sm:flex-nowrap">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: displayColor }} />
            <span className="font-medium text-sm text-graphite dark:text-stone truncate">{tc.name}</span>
            {tc.archived && (
              <span className="text-[10px] bg-stone dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-1.5 py-0.5 rounded shrink-0">
                Archived
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {/* Hourly Rate Badge */}
            <span className="font-mono tabular-nums text-xs px-2 py-0.5 rounded bg-stone/80 dark:bg-graphite text-graphite dark:text-stone border border-graphite/10 dark:border-white/10 font-semibold">
              {formatRate(tc.hourlyRate)}
            </span>

            {/* Entry Usage Count Hint */}
            <span className="text-xs text-gray-600 dark:text-gray-400 min-w-[70px] text-right hidden md:inline">
              {entryCount} {entryCount === 1 ? 'entry' : 'entries'}
            </span>

            {/* Desktop Row Actions */}
            <div className="hidden sm:flex items-center gap-1">
              <button
                onClick={() => handleEditTimecodeStart(tc)}
                className="p-1.5 text-gray-600 dark:text-gray-400 hover:text-signal-dim dark:hover:text-signal hover:bg-signal/10 rounded transition-colors"
                title="Edit Timecode"
                aria-label="Edit Timecode"
              >
                <Edit2 size={15} />
              </button>
              <button
                onClick={() => {
                  setMergingTimecodeId(tc.id);
                  setMergeDestId('');
                  setEditingTimecodeId(null);
                }}
                className="p-1.5 text-gray-600 dark:text-gray-400 hover:text-signal-dim dark:hover:text-signal hover:bg-signal/10 rounded transition-colors"
                title="Merge Timecode"
                aria-label="Merge Timecode"
              >
                <Merge size={15} />
              </button>
              <button
                onClick={async () => await updateTimecode(tc.id, { archived: !tc.archived })}
                className={`p-1.5 rounded transition-colors ${
                  tc.archived
                    ? 'text-verdigris dark:text-emerald-400 hover:bg-verdigris/10'
                    : 'text-gray-600 dark:text-gray-400 hover:text-signal-dim dark:hover:text-signal hover:bg-signal/10'
                }`}
                title={tc.archived ? 'Restore Timecode' : 'Archive Timecode'}
                aria-label={tc.archived ? 'Restore Timecode' : 'Archive Timecode'}
              >
                {tc.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
              </button>
              <button
                onClick={async () => {
                  if (
                    window.confirm(`Delete "${tc.name}" and all its entries? This can be undone from the toast or Trash.`)
                  ) {
                    await deleteTimecode(tc.id);
                  }
                }}
                className="p-1.5 text-gray-600 dark:text-gray-400 hover:text-rust dark:hover:text-rust hover:bg-rust/10 rounded transition-colors"
                title="Delete Timecode (Move to Trash)"
                aria-label="Delete Timecode"
              >
                <Trash2 size={15} />
              </button>
            </div>

            {/* Mobile Row Actions Menu */}
            <div className="sm:hidden relative">
              <button
                onClick={() => setMobileMenuId(mobileMenuId === tc.id ? null : tc.id)}
                className="p-1.5 text-gray-600 dark:text-gray-400 hover:bg-stone dark:hover:bg-graphite rounded transition-colors"
                aria-label="Timecode Actions Menu"
              >
                <MoreVertical size={16} />
              </button>
              {mobileMenuId === tc.id && (
                <div className="absolute right-0 top-full mt-1 z-20 w-36 bg-white dark:bg-graphite border border-graphite/20 dark:border-white/20 rounded-md shadow-lg p-1 flex flex-col gap-0.5 text-xs">
                  <button
                    onClick={() => handleEditTimecodeStart(tc)}
                    className="w-full text-left px-2 py-1.5 text-graphite dark:text-stone hover:bg-stone/50 dark:hover:bg-ink/50 rounded flex items-center gap-2"
                  >
                    <Edit2 size={14} /> Edit
                  </button>
                  <button
                    onClick={() => {
                      setMergingTimecodeId(tc.id);
                      setMergeDestId('');
                      setEditingTimecodeId(null);
                      setMobileMenuId(null);
                    }}
                    className="w-full text-left px-2 py-1.5 text-graphite dark:text-stone hover:bg-stone/50 dark:hover:bg-ink/50 rounded flex items-center gap-2"
                  >
                    <Merge size={14} /> Merge
                  </button>
                  <button
                    onClick={async () => {
                        if (await updateTimecode(tc.id, { archived: !tc.archived })) {
                          setMobileMenuId(null);
                        }
                      }}
                    className="w-full text-left px-2 py-1.5 text-graphite dark:text-stone hover:bg-stone/50 dark:hover:bg-ink/50 rounded flex items-center gap-2"
                  >
                    {tc.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                    {tc.archived ? 'Restore' : 'Archive'}
                  </button>
                  <button
                    onClick={async () => {
                      setMobileMenuId(null);
                      if (
                        window.confirm(`Delete "${tc.name}" and all its entries? This can be undone from the toast or Trash.`)
                      ) {
                        await deleteTimecode(tc.id);
                      }
                    }}
                    className="w-full text-left px-2 py-1.5 text-rust dark:text-rust hover:bg-rust/10 rounded flex items-center gap-2"
                  >
                    <Trash2 size={14} /> Delete
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Inline Expansion Edit Panel */}
      {isEditing && (
        <div className="mt-2 pt-2 border-t border-graphite/10 dark:border-white/10 flex flex-col sm:flex-row items-stretch sm:items-center gap-3 text-sm">
          <div className="flex items-center gap-2 shrink-0">
            <input
              type="color"
              value={editingTimecodeData.color}
              onChange={(e) => setEditingTimecodeData({ ...editingTimecodeData, color: e.target.value })}
              className="w-8 h-8 rounded cursor-pointer border-0 p-0 shrink-0"
              title="Override Group Color"
            />
            <input
              type="text"
              value={editingTimecodeData.color}
              onChange={(e) => setEditingTimecodeData({ ...editingTimecodeData, color: e.target.value })}
              className="w-20 px-2 py-1 text-xs font-mono border border-graphite/20 dark:border-white/20 rounded bg-white dark:bg-graphite text-graphite dark:text-stone outline-none focus-visible:ring-2 focus-visible:ring-signal"
              placeholder="#HEX"
            />
          </div>

          <input
            type="text"
            value={editingTimecodeData.name}
            onChange={(e) => setEditingTimecodeData({ ...editingTimecodeData, name: e.target.value })}
            className="flex-1 min-w-[130px] px-3 py-1.5 border border-graphite/20 dark:border-white/20 rounded outline-none focus-visible:ring-2 focus-visible:ring-signal text-sm bg-white dark:bg-graphite text-graphite dark:text-stone"
            placeholder="Timecode Name"
            autoFocus
          />

          <select
            value={editingTimecodeData.groupId}
            onChange={(e) => setEditingTimecodeData({ ...editingTimecodeData, groupId: e.target.value })}
            className="px-3 py-1.5 border border-graphite/20 dark:border-white/20 rounded outline-none focus-visible:ring-2 focus-visible:ring-signal text-sm bg-white dark:bg-graphite text-graphite dark:text-stone shrink-0"
          >
            <option value="">No Group</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>

          <div className="relative shrink-0">
            <span className="absolute left-2.5 top-1.5 text-gray-500 dark:text-gray-400">{currencySymbol}</span>
            <input
              type="number"
              placeholder="Rate"
              value={editingTimecodeData.hourlyRate}
              onChange={(e) => {
                const val = e.target.value;
                setEditingTimecodeData({
                  ...editingTimecodeData,
                  hourlyRate: val !== '' && Number(val) < 0 ? '0' : val,
                });
              }}
              className="w-24 pl-6 pr-2 py-1.5 border border-graphite/20 dark:border-white/20 rounded outline-none focus-visible:ring-2 focus-visible:ring-signal bg-white dark:bg-graphite text-graphite dark:text-stone text-sm"
              min="0"
              step="0.01"
            />
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => handleEditTimecodeSave(tc.id)}
              className="px-3 py-1.5 bg-signal hover:bg-signal-dim text-ink text-sm font-semibold rounded transition-colors flex items-center justify-center gap-1"
            >
              <Check size={16} /> Save
            </button>
            <button
              onClick={() => setEditingTimecodeId(null)}
              className="px-3 py-1.5 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-800 text-sm font-medium rounded transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Inline Expansion Merge Panel */}
      {isMerging && (
        <div className="mt-2 pt-2 border-t border-graphite/10 dark:border-white/10 flex flex-col sm:flex-row items-stretch sm:items-center gap-3 text-sm">
          <span className="font-medium text-graphite dark:text-stone shrink-0">Merge "{tc.name}" into:</span>
          <select
            value={mergeDestId}
            onChange={(e) => setMergeDestId(e.target.value)}
            className="flex-1 min-w-[150px] px-3 py-1.5 border border-graphite/20 dark:border-white/20 rounded outline-none focus-visible:ring-2 focus-visible:ring-signal bg-white dark:bg-graphite text-graphite dark:text-stone"
          >
            <option value="" disabled>
              Select destination timecode
            </option>
            {timecodes
              .filter((t) => t.id !== tc.id)
              .map((t) => {
                const g = groups.find((grp) => grp.id === t.groupId);
                return (
                  <option key={t.id} value={t.id}>
                    {t.name} {g ? `(${g.name})` : '(No Group)'} {t.archived ? '[Archived]' : ''}
                  </option>
                );
              })}
          </select>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => handleMergeSave(tc.id)}
              disabled={!mergeDestId}
              className="px-3 py-1.5 bg-signal hover:bg-signal-dim disabled:opacity-50 text-ink text-sm font-semibold rounded transition-colors"
            >
              Confirm Merge
            </button>
            <button
              onClick={() => {
                setMergingTimecodeId(null);
                setMergeDestId('');
              }}
              className="px-3 py-1.5 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-800 text-sm font-medium rounded transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* Helper Component for Contextual "+ Add timecode" Inline Form */
interface RenderAddTimecodeFormProps {
  groupId: string | null;
  newTimecodeName: string;
  setNewTimecodeName: (name: string) => void;
  newTimecodeColor: string;
  setNewTimecodeColor: (color: string) => void;
  newTimecodeRate: string;
  setNewTimecodeRate: (rate: string) => void;
  handleCreateTimecode: (groupId: string | null) => Promise<void>;
  setAddingTimecodeGroupId: (groupId: string | null) => void;
  currencySymbol: string;
}

function renderAddTimecodeForm({
  groupId,
  newTimecodeName,
  setNewTimecodeName,
  newTimecodeColor,
  setNewTimecodeColor,
  newTimecodeRate,
  setNewTimecodeRate,
  handleCreateTimecode,
  setAddingTimecodeGroupId,
  currencySymbol,
}: RenderAddTimecodeFormProps) {
  return (
    <div className="mt-2 p-3 bg-stone/50 dark:bg-ink/40 rounded-lg border border-dashed border-graphite/30 dark:border-white/30 flex flex-col sm:flex-row items-stretch sm:items-center gap-3 text-sm">
      <div className="flex items-center gap-2 shrink-0">
        <input
          type="color"
          value={newTimecodeColor}
          onChange={(e) => setNewTimecodeColor(e.target.value)}
          className="w-8 h-8 rounded cursor-pointer border-0 p-0 shrink-0"
          title="Timecode Color"
        />
        <input
          type="text"
          value={newTimecodeColor}
          onChange={(e) => setNewTimecodeColor(e.target.value)}
          className="w-20 px-2 py-1 text-xs font-mono border border-graphite/20 dark:border-white/20 rounded bg-white dark:bg-graphite text-graphite dark:text-stone outline-none focus-visible:ring-2 focus-visible:ring-signal"
          placeholder="#HEX"
        />
      </div>

      <input
        type="text"
        placeholder="New Timecode Name"
        value={newTimecodeName}
        onChange={(e) => setNewTimecodeName(e.target.value)}
        className="flex-1 min-w-[140px] px-3 py-1.5 border border-graphite/20 dark:border-white/20 rounded outline-none focus-visible:ring-2 focus-visible:ring-signal text-sm bg-white dark:bg-graphite text-graphite dark:text-stone placeholder-gray-500 dark:placeholder-gray-400"
        autoFocus
      />

      <div className="relative shrink-0">
        <span className="absolute left-2.5 top-1.5 text-gray-500 dark:text-gray-400">{currencySymbol}</span>
        <input
          type="number"
          placeholder="Rate"
          value={newTimecodeRate}
          onChange={(e) => {
            const val = e.target.value;
            setNewTimecodeRate(val !== '' && Number(val) < 0 ? '0' : val);
          }}
          className="w-24 pl-6 pr-2 py-1.5 border border-graphite/20 dark:border-white/20 rounded outline-none focus-visible:ring-2 focus-visible:ring-signal bg-white dark:bg-graphite text-graphite dark:text-stone text-sm placeholder-gray-500 dark:placeholder-gray-400"
          min="0"
          step="0.01"
        />
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={() => handleCreateTimecode(groupId)}
          disabled={!newTimecodeName.trim()}
          className="px-3 py-1.5 bg-graphite hover:bg-ink dark:bg-stone dark:hover:bg-gray-300 text-stone dark:text-ink disabled:opacity-50 text-sm font-semibold rounded transition-colors"
        >
          Add Timecode
        </button>
        <button
          onClick={() => setAddingTimecodeGroupId(null)}
          className="px-3 py-1.5 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-800 text-sm font-medium rounded transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
