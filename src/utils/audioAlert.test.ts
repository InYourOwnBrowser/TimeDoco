import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { unlockAudioAlert, playOverrunChime } from './audioAlert';

describe('audioAlert utility', () => {
  let mockResume: ReturnType<typeof vi.fn>;
  let mockCreateOscillator: ReturnType<typeof vi.fn>;
  let mockCreateGain: ReturnType<typeof vi.fn>;
  let mockOscillator: any;
  let mockGain: any;

  beforeEach(() => {
    mockResume = vi.fn().mockResolvedValue(undefined);
    mockOscillator = {
      type: 'sine',
      frequency: { value: 0 },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
    mockGain = {
      gain: {
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
    };
    mockCreateOscillator = vi.fn().mockReturnValue(mockOscillator);
    mockCreateGain = vi.fn().mockReturnValue(mockGain);

    class MockAudioContext {
      currentTime = 10;
      destination = {};
      state = 'suspended';
      resume = mockResume;
      createOscillator = mockCreateOscillator;
      createGain = mockCreateGain;
    }

    vi.stubGlobal('AudioContext', MockAudioContext);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('unlockAudioAlert calls resume on the AudioContext', () => {
    unlockAudioAlert();
    expect(mockResume).toHaveBeenCalledTimes(1);
  });

  it('playOverrunChime creates oscillator and gain nodes for chime beeps and resumes suspended context', () => {
    playOverrunChime();
    expect(mockResume).toHaveBeenCalled();
    expect(mockCreateOscillator).toHaveBeenCalledTimes(6);
    expect(mockCreateGain).toHaveBeenCalledTimes(6);
    expect(mockOscillator.start).toHaveBeenCalledTimes(6);
    expect(mockOscillator.stop).toHaveBeenCalledTimes(6);
    expect(mockOscillator.frequency.value).toBe(880);
  });
});
