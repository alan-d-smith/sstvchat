import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Avatar } from './Avatar';
import type { Person } from '../types';

const person = (id: string, seed: number, badge?: string): Person => ({ id, name: id, seed, color: '#0FADFF', badge });

const ana = person('ana', 1);
const bo = person('bo', 2);
const cy = person('cy', 3);
const di = person('di', 4);

describe('Avatar', () => {
  afterEach(cleanup);

  it('renders one face svg for a single person', () => {
    const { container } = render(<Avatar people={[ana]} size={48} />);
    expect(container.querySelectorAll('svg')).toHaveLength(1);
  });

  it('renders one face svg per person in a group', () => {
    const two = render(<Avatar people={[ana, bo]} size={48} />);
    expect(two.container.querySelectorAll('svg')).toHaveLength(2);
    const three = render(<Avatar people={[ana, bo, cy]} size={48} />);
    expect(three.container.querySelectorAll('svg')).toHaveLength(3);
  });

  it('shows at most three faces', () => {
    const { container } = render(<Avatar people={[ana, bo, cy, di]} size={48} />);
    expect(container.querySelectorAll('svg')).toHaveLength(3);
  });

  it('renders the badge text', () => {
    render(<Avatar people={[ana]} size={48} badge="😊" />);
    expect(screen.getByText('😊')).toBeInTheDocument();
  });

  it('draws the same face for the same seed and a different face for another seed', () => {
    const face = (p: Person) => render(<Avatar people={[p]} size={48} />).container.querySelector('svg')!.innerHTML;
    expect(face(person('x', 7))).toBe(face(person('y', 7)));
    expect(face(person('x', 7))).not.toBe(face(person('x', 8)));
  });
});
