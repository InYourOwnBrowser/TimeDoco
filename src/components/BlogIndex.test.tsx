import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { BlogIndex } from './BlogIndex';
import { describe, it, expect, beforeEach } from 'vitest';

describe('BlogIndex', () => {
  beforeEach(() => {
    cleanup();
  });

  it('renders blog title and posts', () => {
    render(
      <BrowserRouter>
        <BlogIndex />
      </BrowserRouter>
    );

    expect(screen.getByRole('heading', { level: 1, name: 'TimeDoco Blog & Guides' })).toBeDefined();
    expect(screen.getByText('A Guide to Tax and Multi-Currency Reporting in TimeDoco')).toBeDefined();
    expect(screen.getByText('Why Client-Side Privacy Matters for Contractors and Freelancers')).toBeDefined();
  });

  it('filters posts based on search input', () => {
    render(
      <BrowserRouter>
        <BlogIndex />
      </BrowserRouter>
    );

    const searchInput = screen.getByPlaceholderText('Search posts or tags...');
    fireEvent.change(searchInput, { target: { value: 'Tax' } });

    expect(screen.getByText('A Guide to Tax and Multi-Currency Reporting in TimeDoco')).toBeDefined();
    expect(screen.queryByText('Why Client-Side Privacy Matters for Contractors and Freelancers')).toBeNull();
  });
});
