import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import ProgressivePhoto from './ProgressivePhoto.vue';
describe('ProgressivePhoto',()=>{
  enableAutoUnmount(afterEach);
  it('holds a same-photo thumbnail until the preview loads and resets on navigation',async()=>{
    const wrapper=mount(ProgressivePhoto,{props:{src:'/previews/one.webp',thumbnailSrc:'/thumbnails/one.webp',alt:'One',width:1200,height:800}});
    expect(wrapper.get('.progressive-photo__thumbnail').attributes('src')).toBe('/thumbnails/one.webp');
    expect(wrapper.get('.progressive-photo__thumbnail').attributes('aria-hidden')).toBe('true');
    const main=()=>wrapper.get('img.progressive-photo__preview');
    expect(main().attributes('data-loaded')).toBe('false');
    await main().trigger('load');
    expect(wrapper.classes()).toContain('progressive-photo--ready');
    await wrapper.setProps({src:'/previews/two.webp',thumbnailSrc:'/thumbnails/two.webp',alt:'Two'});
    expect(wrapper.classes()).not.toContain('progressive-photo--ready');
    expect(wrapper.get('.progressive-photo__thumbnail').attributes('src')).toBe('/thumbnails/two.webp');
    await main().trigger('error');
    await flushPromises();
    expect(main().attributes('src')).toBe('/thumbnails/two.webp');
    await main().trigger('load');
    expect(wrapper.classes()).toContain('progressive-photo--ready');
    expect(wrapper.find('img[src^="/api/originals"]').exists()).toBe(false);
  });
  it('does not add a redundant thumbnail when the preview already uses that URL',()=>{
    const wrapper=mount(ProgressivePhoto,{props:{src:'/thumbnails/one.webp',thumbnailSrc:'/thumbnails/one.webp',alt:'One',width:100,height:100}});
    expect(wrapper.findAll('img')).toHaveLength(1);
  });
});