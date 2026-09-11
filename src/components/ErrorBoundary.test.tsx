import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

const reload = vi.fn();

const Throws = ({ error }: { error: Error }) => {
  throw error;
};

beforeEach(() => {
  reload.mockClear();
  sessionStorage.clear();
  // Only what is used: spreading the real Location would drop its prototype.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { href: window.location.href, origin: window.location.origin, reload },
  });
  // React logs the caught error, and so does the boundary. Neither is the
  // subject here.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe('ErrorBoundary', () => {
  it('shows the error screen for an ordinary failure, and does not reload', () => {
    render(
      <ErrorBoundary>
        <Throws error={new Error('entry.startTime is not a Date')} />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Something went wrong')).not.toBeNull();
    expect(screen.getByText(/An unexpected error occurred/)).not.toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });

  // Awaited: the recovery flushes pending debounced writes before it reloads,
  // so the draft a field is still holding is not lost to the reload that fixes
  // the page. The decision to reload is still made synchronously.
  it('reloads for a code-split chunk the origin no longer serves', async () => {
    render(
      <ErrorBoundary>
        <Throws error={new Error('Failed to fetch dynamically imported module: /assets/AnalysisView-abc.js')} />
      </ErrorBoundary>,
    );

    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it('explains a missing chunk in its own terms once reloading has not fixed it', () => {
    // The guard is already set, so this is the second failure: the reload has
    // happened and the chunk is still missing.
    sessionStorage.setItem('timedoco.reloadedForChunk', '1');

    render(
      <ErrorBoundary>
        <Throws error={new Error('Failed to fetch dynamically imported module: /assets/AnalysisView-abc.js')} />
      </ErrorBoundary>,
    );

    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByText(/updated while this tab was open/)).not.toBeNull();
  });
});
