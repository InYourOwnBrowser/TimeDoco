export interface Group {
  id: string; // UUID
  name: string;
  color: string; // hex
  archived: boolean;
}

export interface Timecode {
  id: string; // UUID
  name: string;
  groupId: string | null;
  color?: string; // hex, optional override
  hourlyRate: number | null;
  archived: boolean;
}

export interface PauseSegment {
  pauseStart: string; // ISO datetime
  pauseEnd?: string; // ISO datetime
}

export interface EditHistory {
  field: string;
  oldValue: any;
  newValue: any;
  editedAt: string; // ISO datetime
}

export interface Entry {
  id: string; // UUID
  timecodeId: string;
  startTime: string; // ISO datetime
  endTime: string | null; // null while running
  duration: number; // seconds, recalculated on edit
  note: string;
  isRunning: boolean; // true only for single currently active entry
  isPaused: boolean;
  pausedSegments: PauseSegment[];
  editHistory: EditHistory[];
  createdAt: string; // ISO datetime
  updatedAt: string; // ISO datetime
}

export interface Settings {
  id: string; // 'user-settings'
  lastBackupDate: string | null; // ISO datetime
  reminderIntervalDays: number;
  roundingRule: 'none' | '5min' | '10min' | '15min';
  idleThresholdMinutes: number;
  weeklyTargetHours: number | null;
  encryptionEnabled: boolean;
  theme?: 'light' | 'dark' | 'system';
}
