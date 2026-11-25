import { nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import ResilientImage from './ResilientImage.vue';

describe('ResilientImage', () => {
  it('falls back to the original source when the preview source fails', async () => {
    const wrapper = mount(ResilientImage, {
      props: {
        src: '/previews/NaturePlanet/pexels-photo-2770371.webp',
        fallbackSrc: '/api/originals/2770371',
        alt: 'NaturePlanet preview',
        loading: 'eager'
      }
    });

    expect(wrapper.get('img').attributes('src')).toContain('/previews/NaturePlanet/pexels-photo-2770371.webp');

    await wrapper.get('img').trigger('error');
    await nextTick();

    expect(wrapper.get('img').attributes('src')).toContain('/api/originals/2770371');
  });

  it('ignores load/error events from a previous photo after navigation', async () => {
    const wrapper=mount(ResilientImage,{props:{src:'/previews/first.webp',alt:'first',fallbackSrc:'/thumbnails/first.webp'}});
    const old=wrapper.get('img').element;
    await wrapper.setProps({src:'/previews/second.webp',alt:'second',fallbackSrc:'/thumbnails/second.webp'});
    old.dispatchEvent(new Event('load'));
    old.dispatchEvent(new Event('error'));
    await nextTick();
    expect(wrapper.get('img').attributes('src')).toBe('/previews/second.webp');
    expect(wrapper.get('img').attributes('data-loaded')).toBe('false');
    expect(wrapper.emitted('ready')).toBeUndefined();
    await wrapper.get('img').trigger('load');
    expect(wrapper.get('img').attributes('data-loaded')).toBe('true');
    expect(wrapper.emitted('ready')).toHaveLength(1);
    expect(wrapper.get('img').attributes('decoding')).toBe('async');
  });

  it('offers a manual retry after the WebP and fallback fail', async () => {
    const wrapper = mount(ResilientImage, {
      props: {
        src: '/previews/photo.webp',
        fallbackSrc: '/thumbnails/photo.webp',
        alt: 'photo.HEIC',
        showRetry: true,
        retryWhile: true,
        maxRetries: 0
      }
    });

    await wrapper.get('img').trigger('error');
    expect(wrapper.get('img').attributes('src')).toBe('/thumbnails/photo.webp');
    await wrapper.get('img').trigger('error');
    await wrapper.get('button').trigger('click');
    expect(wrapper.get('img').attributes('src')).toBe('/previews/photo.webp?retry=1');
  });
});
