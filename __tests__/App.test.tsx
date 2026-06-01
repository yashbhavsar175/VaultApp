/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App, { getCachedProfileRouteHint, summarizeStartupError } from '../App';

test('renders correctly', async () => {
  await ReactTestRenderer.act(() => {
    ReactTestRenderer.create(<App />);
  });
});

describe('cached profile route hints', () => {
  it('accepts a complete cached profile owned by the current user without requiring email', () => {
    expect(getCachedProfileRouteHint({
      userId: 'user-current',
      name: 'Current User',
    }, 'user-current')).toBe('complete');
  });

  it('rejects a complete cached profile owned by a different user', () => {
    expect(getCachedProfileRouteHint({
      userId: 'user-stale',
      name: 'Stale User',
    }, 'user-current')).toBeNull();
  });

  it('does not bypass profile setup when the cached name is missing', () => {
    expect(getCachedProfileRouteHint({
      userId: 'user-current',
      name: ' ',
    }, 'user-current')).toBeNull();
  });
});

describe('auth startup log privacy', () => {
  it('summarizes errors without retaining raw identity or session payloads', () => {
    expect(summarizeStartupError({
      code: 'PGRST123',
      name: 'PostgrestError',
      status: 400,
      message: 'failed for private@example.com',
      session: { access_token: 'raw-token' },
      profile: { full_name: 'Private Name' },
    })).toEqual({
      code: 'PGRST123',
      name: 'PostgrestError',
      status: 400,
    });
  });
});
