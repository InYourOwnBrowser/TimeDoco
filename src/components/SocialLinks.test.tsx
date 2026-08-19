import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { SocialLinks } from './SocialLinks';

describe('SocialLinks', () => {
  it('renders links to X, Discord, and Medium with correct attributes', () => {
    render(<SocialLinks />);

    const xLink = screen.getByRole('link', { name: /follow on x/i }) as HTMLAnchorElement;
    expect(xLink.getAttribute('href')).toBe('https://x.com/_InYOB_');
    expect(xLink.getAttribute('target')).toBe('_blank');
    expect(xLink.getAttribute('rel')).toBe('noopener noreferrer');

    const discordLink = screen.getByRole('link', { name: /join discord/i }) as HTMLAnchorElement;
    expect(discordLink.getAttribute('href')).toBe('https://discord.gg/p6XhpaDm4R');
    expect(discordLink.getAttribute('target')).toBe('_blank');
    expect(discordLink.getAttribute('rel')).toBe('noopener noreferrer');

    const mediumLink = screen.getByRole('link', { name: /read on medium/i }) as HTMLAnchorElement;
    expect(mediumLink.getAttribute('href')).toBe('https://medium.com/@InYourOwnBrowser');
    expect(mediumLink.getAttribute('target')).toBe('_blank');
    expect(mediumLink.getAttribute('rel')).toBe('noopener noreferrer');
  });
});
