import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { LensCarousel } from './LensCarousel';
import { FILTERS } from '../media/filters';

describe('LensCarousel', () => {
  it('offers every filter, Normal first, with the value checked', () => {
    const { container } = render(<LensCarousel value="none" onChange={() => {}} />);
    const names = screen.getAllByRole('radio').map((r) => r.getAttribute('aria-label'));
    expect(names).toEqual(FILTERS.map((f) => f.label));
    expect(names).toEqual([
      'Normal', 'Mono', 'Warm', 'Scanline', 'Thermal', 'Pixel', 'Comic', 'Glitch', 'Duotone', 'Halftone', 'Mirror', 'Vapor',
    ]);
    expect(screen.getByRole('radio', { name: 'Normal' })).toBeChecked();
    // Normal is the bare slot; every other lens shows its swatch.
    expect(container.querySelectorAll('.lens-carousel__thumb')).toHaveLength(FILTERS.length - 1);
    expect(screen.getByRole('radio', { name: 'Normal' }).querySelector('.lens-carousel__thumb')).toBeNull();
  });

  it('selects the new filters and flashes their names', () => {
    const onChange = vi.fn();
    const { rerender, container } = render(<LensCarousel value="none" onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Thermal' }));
    expect(onChange).toHaveBeenLastCalledWith('thermal');
    rerender(<LensCarousel value="thermal" onChange={onChange} />);
    expect(screen.getByRole('radio', { name: 'Thermal' })).toBeChecked();
    expect(container.querySelector('.lens-carousel__label')).toHaveTextContent('Thermal');
    fireEvent.keyDown(screen.getByRole('radiogroup', { name: 'Filters' }), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('pixel');
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
