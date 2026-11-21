import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { LensCarousel } from './LensCarousel';

describe('LensCarousel', () => {
  it('offers Normal, Mono and Warm with the value checked', () => {
    render(<LensCarousel value="none" onChange={() => {}} />);
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('aria-label'))).toEqual(['Normal', 'Mono', 'Warm']);
    expect(screen.getByRole('radio', { name: 'Normal' })).toBeChecked();
  });

  it('tapping a lens selects it; arrow keys step through them', () => {
    const onChange = vi.fn();
    render(<LensCarousel value="none" onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Warm' }));
    expect(onChange).toHaveBeenLastCalledWith('warm');
    fireEvent.keyDown(screen.getByRole('radiogroup', { name: 'Filters' }), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('mono');
  });

  it('flashes the new filter name, then hides it', () => {
    vi.useFakeTimers();
    try {
      const { rerender, container } = render(<LensCarousel value="none" onChange={() => {}} />);
      const label = container.querySelector('.lens-carousel__label')!;
      expect(label).not.toHaveClass('is-shown');
      rerender(<LensCarousel value="mono" onChange={() => {}} />);
      expect(label).toHaveTextContent('Mono');
      expect(label).toHaveClass('is-shown');
      act(() => {
        vi.advanceTimersByTime(1200);
      });
      expect(label).not.toHaveClass('is-shown');
    } finally {
      vi.useRealTimers();
    }
  });
});
