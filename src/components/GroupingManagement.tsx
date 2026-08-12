import React, { useState } from 'react';
import { useTimeTracker } from '../context/TimeTrackerContext';
import { Edit2, Archive, ArchiveRestore, Check, X, Trash2 } from 'lucide-react';
import type { Group, Timecode } from '../types';

export const GroupingManagement: React.FC = () => {
  const { groups, timecodes, addGroup, updateGroup, deleteGroup, updateTimecode, deleteTimecode } = useTimeTracker();

  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupData, setEditingGroupData] = useState<{ name: string; color: string }>({ name: '', color: '' });

  const [editingTimecodeId, setEditingTimecodeId] = useState<string | null>(null);
  const [editingTimecodeData, setEditingTimecodeData] = useState<{ name: string; color: string; groupId: string; hourlyRate: string }>({ name: '', color: '', groupId: '', hourlyRate: '' });

  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupColor, setNewGroupColor] = useState('#3b82f6'); // blue-500

  const handleEditGroupStart = (group: Group) => {
    setEditingGroupId(group.id);
    setEditingGroupData({ name: group.name, color: group.color });
  };

  const handleEditGroupSave = async (id: string) => {
    if (!editingGroupData.name.trim()) return;
    await updateGroup(id, { name: editingGroupData.name, color: editingGroupData.color });
    setEditingGroupId(null);
  };

  const handleEditTimecodeStart = (tc: Timecode) => {
    setEditingTimecodeId(tc.id);
    setEditingTimecodeData({
      name: tc.name,
      color: tc.color || '',
      groupId: tc.groupId || '',
      hourlyRate: tc.hourlyRate ? tc.hourlyRate.toString() : '',
    });
  };

  const handleEditTimecodeSave = async (id: string) => {
    if (!editingTimecodeData.name.trim()) return;
    const parsedRate = parseFloat(editingTimecodeData.hourlyRate);
    await updateTimecode(id, {
      name: editingTimecodeData.name,
      color: editingTimecodeData.color || undefined,
      groupId: editingTimecodeData.groupId || null,
      hourlyRate: isNaN(parsedRate) ? null : parsedRate,
    });
    setEditingTimecodeId(null);
  };

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) return;
    await addGroup(newGroupName, newGroupColor);
    setNewGroupName('');
  };

  return (
    <div className="w-full max-w-4xl mx-auto space-y-8">
      {/* Groups Section */}
      <section className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 transition-colors">
        <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-200 mb-4 border-b dark:border-gray-700 pb-2">Groups</h2>

        <div className="space-y-4 mb-6">
          {groups.map(group => (
            <div key={group.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-100 dark:border-gray-700 transition-colors">
              {editingGroupId === group.id ? (
                <div className="flex items-center gap-3 w-full">
                  <input
                    type="color"
                    value={editingGroupData.color}
                    onChange={(e) => setEditingGroupData({ ...editingGroupData, color: e.target.value })}
                    className="w-8 h-8 rounded cursor-pointer border-0 p-0"
                  />
                  <input
                    type="text"
                    value={editingGroupData.name}
                    onChange={(e) => setEditingGroupData({ ...editingGroupData, name: e.target.value })}
                    className="flex-1 px-3 py-1 border border-gray-300 dark:border-gray-600 rounded outline-none focus:ring-1 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    autoFocus
                  />
                  <button onClick={() => handleEditGroupSave(group.id)} className="p-1 text-green-600 dark:text-green-400 hover:text-green-800 dark:hover:text-green-300 transition-colors">
                    <Check size={18} />
                  </button>
                  <button onClick={() => setEditingGroupId(null)} className="p-1 text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 transition-colors">
                    <X size={18} />
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-3">
                    <div className="w-4 h-4 rounded-full" style={{ backgroundColor: group.color }}></div>
                    <span className="font-medium text-gray-800 dark:text-gray-200">{group.name}</span>
                    {group.archived && <span className="text-xs bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 px-2 py-0.5 rounded">Archived</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleEditGroupStart(group)}
                      className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded transition-colors"
                      title="Edit Group"
                    >
                      <Edit2 size={16} />
                    </button>
                    <button
                      onClick={() => {
                          if (group.archived || window.confirm('Are you sure you want to archive this group? It will be hidden from selection.')) {
                            updateGroup(group.id, { archived: !group.archived });
                          }
                        }}
                      className={`p-1.5 rounded transition-colors ${group.archived ? 'text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/30' : 'text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/30'}`}
                      title={group.archived ? 'Restore' : 'Archive'}
                    >
                      {group.archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm('Are you sure you want to delete this group? This action cannot be undone.')) {
                          deleteGroup(group.id);
                        }
                      }}
                      className="p-1.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded transition-colors"
                      title="Delete Group"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3 mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
          <input
            type="color"
            value={newGroupColor}
            onChange={(e) => setNewGroupColor(e.target.value)}
            className="w-8 h-8 rounded cursor-pointer border-0 p-0"
          />
          <input
            type="text"
            placeholder="New Group Name"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded outline-none focus:ring-1 focus:ring-blue-500 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500"
          />
          <button
            onClick={handleCreateGroup}
            disabled={!newGroupName.trim()}
            className="px-4 py-2 bg-blue-600 dark:bg-blue-700 text-white rounded text-sm font-medium hover:bg-blue-700 dark:hover:bg-blue-600 disabled:opacity-50 transition-colors"
          >
            Add Group
          </button>
        </div>
      </section>

      {/* Timecodes Section */}
      <section className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 transition-colors">
        <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-200 mb-4 border-b dark:border-gray-700 pb-2">Timecodes</h2>

        <div className="space-y-3">
          {timecodes.map(tc => {
            const group = groups.find(g => g.id === tc.groupId);
            return (
              <div key={tc.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-100 dark:border-gray-700 transition-colors">
                {editingTimecodeId === tc.id ? (
                   <div className="flex items-center gap-3 w-full flex-wrap">
                      <input
                        type="color"
                        value={editingTimecodeData.color}
                        onChange={(e) => setEditingTimecodeData({ ...editingTimecodeData, color: e.target.value })}
                        className="w-8 h-8 rounded cursor-pointer border-0 p-0"
                        title="Override Group Color"
                      />
                      <input
                        type="text"
                        value={editingTimecodeData.name}
                        onChange={(e) => setEditingTimecodeData({ ...editingTimecodeData, name: e.target.value })}
                        className="flex-1 min-w-[150px] px-3 py-1 border border-gray-300 dark:border-gray-600 rounded outline-none focus:ring-1 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        autoFocus
                      />
                      <select
                        value={editingTimecodeData.groupId}
                        onChange={(e) => setEditingTimecodeData({ ...editingTimecodeData, groupId: e.target.value })}
                        className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded outline-none focus:ring-1 focus:ring-blue-500 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      >
                        <option value="">No Group</option>
                        {groups.map(g => (
                          <option key={g.id} value={g.id}>{g.name}</option>
                        ))}
                      </select>
                      <input
                        type="number"
                        placeholder="Rate (opt)"
                        value={editingTimecodeData.hourlyRate}
                        onChange={(e) => setEditingTimecodeData({ ...editingTimecodeData, hourlyRate: e.target.value })}
                        className="w-24 px-3 py-1 border border-gray-300 dark:border-gray-600 rounded outline-none focus:ring-1 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                        min="0"
                        step="0.01"
                      />
                      <button onClick={() => handleEditTimecodeSave(tc.id)} className="p-1 text-green-600 dark:text-green-400 hover:text-green-800 dark:hover:text-green-300 transition-colors">
                        <Check size={18} />
                      </button>
                      <button onClick={() => setEditingTimecodeId(null)} className="p-1 text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 transition-colors">
                        <X size={18} />
                      </button>
                   </div>
                ) : (
                  <>
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: tc.color || group?.color || '#cbd5e1' }}></div>
                        <span className="font-medium text-gray-800 dark:text-gray-200">{tc.name}</span>
                        {tc.archived && <span className="text-xs bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 px-2 py-0.5 rounded ml-2">Archived</span>}
                      </div>
                      <span className="text-xs text-gray-500 dark:text-gray-400 mt-1 ml-5">
                        Group: {group ? group.name : 'None'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleEditTimecodeStart(tc)}
                        className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded transition-colors"
                        title="Edit Timecode"
                      >
                        <Edit2 size={16} />
                      </button>
                      <button
                        onClick={() => {
                            if (tc.archived || window.confirm('Are you sure you want to archive this timecode? It will be hidden from selection.')) {
                              updateTimecode(tc.id, { archived: !tc.archived });
                            }
                          }}
                        className={`p-1.5 rounded transition-colors ${tc.archived ? 'text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/30' : 'text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/30'}`}
                        title={tc.archived ? 'Restore' : 'Archive'}
                      >
                        {tc.archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
                      </button>
                      <button
                        onClick={() => {
                          if (window.confirm('Are you sure you want to delete this timecode? This action cannot be undone.')) {
                            deleteTimecode(tc.id);
                          }
                        }}
                        className="p-1.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded transition-colors"
                        title="Delete Timecode"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};
