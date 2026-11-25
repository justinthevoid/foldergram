import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { i18n } from '../locales';
import { useAppStore } from '../stores/app';
import type { PostMediaItem } from '../types/api';
import CarouselMediaStage from './CarouselMediaStage.vue';

describe('CarouselMediaStage', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  const mockItems: PostMediaItem[] = [
    {
      imageId: 1,
      filename: 'slide1.mp4',
      mediaType: 'video',
      width: 1080,
      height: 1080,
      previewUrl: '/preview1.mp4',
      thumbnailUrl: '/thumb1.webp',
      originalUrl: '/original1.mp4',
      position: 1
    },
    {
      imageId: 2,
      filename: 'slide2.jpg',
      mediaType: 'image',
      width: 1080,
      height: 1080,
      previewUrl: '/preview2.jpg',
      thumbnailUrl: '/thumb2.webp',
      originalUrl: '/original2.jpg',
      position: 2
    }
  ];

  it('renders video slides using VideoMediaPlayer and navigates between slides', async () => {
    const wrapper = mount(CarouselMediaStage, {
      props: {
        items: mockItems,
        modelValue: 0,
        autoplay: true
      },
      global: {
        plugins: [i18n]
      }
    });

    const player = wrapper.findComponent({ name: 'VideoMediaPlayer' });
    expect(player.exists()).toBe(true);
    expect(player.props('autoplay')).toBe(true);
    expect(player.props('load')).toBe('eager');

    const stage = wrapper.get('[aria-roledescription="carousel"]');
    expect(stage.classes()).toContain('carousel-media-stage');
    const nextBtn = wrapper.find('button[aria-label="Next carousel item"]');
    expect(nextBtn.exists()).toBe(true);
    expect(nextBtn.classes()).toContain('h-11');
    expect(nextBtn.classes()).toContain('w-11');
    expect(nextBtn.classes()).toContain('focus-visible:outline-2');
    await nextBtn.trigger('click');

    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([1]);
  });

  it('defers feed video loading while retaining eager viewer loading', async () => {
    const wrapper = mount(CarouselMediaStage, { props: { items: mockItems, modelValue: 0, loading: 'lazy' } });
    try {
      const player = wrapper.getComponent({ name: 'VideoMediaPlayer' });
      expect(player.props('load')).toBe('visible');
      await wrapper.setProps({ loading: 'eager' });
      expect(player.props('load')).toBe('eager');
    } finally {
      wrapper.unmount();
    }
  });

  it('ignores pointer swipes when initiated on controls with data-swipe-ignore', async () => {
    const wrapper = mount(CarouselMediaStage, {
      props: {
        items: mockItems,
        modelValue: 0
      },
      global: {
        plugins: [i18n]
      }
    });

    const root = wrapper.element as HTMLElement;
    const progressFooter = wrapper.find('.video-progress-footer');
    expect(progressFooter.exists()).toBe(true);

    // Trigger pointerdown on progress footer (data-swipe-ignore="true")
    await progressFooter.trigger('pointerdown', {
      pointerId: 1,
      clientX: 200,
      button: 0
    });

    // Trigger pointerup with horizontal movement
    await wrapper.trigger('pointerup', {
      pointerId: 1,
      clientX: 50
    });

    // Should NOT have navigated because pointerdown was on an ignored element
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });

  it('recognizes a deliberate same-slide double tap without liking during swipes, video controls or slide changes', async () => {
    const items=[mockItems[0]!, mockItems[1]!, {...mockItems[1]!,imageId:3,position:3}];
    const wrapper=mount(CarouselMediaStage,{props:{items,modelValue:1,doubleTapLike:true}});
    let now=1000;
    const clock=vi.spyOn(Date,'now').mockImplementation(()=>now);
    // jsdom may lack PointerEvent; define the full gesture payload explicitly.
    const dispatch=async(type:string,x:number,y:number,isPrimary:boolean,pointerId:number)=>{
      const event=Object.assign(new Event(type,{bubbles:true,cancelable:true}),{
        pointerId,pointerType:'touch',isPrimary,button:0,clientX:x,clientY:y
      });
      wrapper.element.dispatchEvent(event);
      await wrapper.vm.$nextTick();
    };
    const down=async(x=100,y=100,primary=true,pointerId=1)=>dispatch('pointerdown',x,y,primary,pointerId);
    const up=async(x=100,y=100,pointerId=1)=>dispatch('pointerup',x,y,true,pointerId);
    const tap=async(x=100,y=100)=>{await down(x,y);now+=30;await up(x,y);now+=90;};
    try {
      await tap();await tap();
      expect(wrapper.emitted('doubleTap')).toHaveLength(1);
      await tap();await down();await up(30,100);
      expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([2]);
      expect(wrapper.emitted('doubleTap')).toHaveLength(1);
      await wrapper.setProps({modelValue:2});
      await tap();await down();await up(20,220); // predominantly vertical
      expect(wrapper.emitted('update:modelValue')).toHaveLength(1);
      expect(wrapper.emitted('doubleTap')).toHaveLength(1);
      await tap();
      await wrapper.setProps({modelValue:1});
      await tap();
      expect(wrapper.emitted('doubleTap')).toHaveLength(1);
      await down();await down(130,100,false,2);await up();await tap();
      expect(wrapper.emitted('doubleTap')).toHaveLength(1);
      await wrapper.setProps({modelValue:0});
      await tap();await tap();
      expect(wrapper.emitted('doubleTap')).toHaveLength(1);
      await wrapper.setProps({modelValue:1,doubleTapLike:false});
      await tap();await tap();
      expect(wrapper.emitted('doubleTap')).toHaveLength(1);
    }finally{clock.mockRestore();wrapper.unmount();}
  });

  it('does not change carousel slides while the browser viewport is magnified', async () => {
    const items = [mockItems[1]!, { ...mockItems[1]!, imageId: 3, position: 3 }];
    const wrapper = mount(CarouselMediaStage, { props: { items, modelValue: 0, doubleTapLike: true } });
    const descriptor = Object.getOwnPropertyDescriptor(window, 'visualViewport');
    const scale = (value: number) => Object.defineProperty(window, 'visualViewport', { configurable: true, value: { scale: value } });
    const dispatch = async (type: string, x: number) => {
      wrapper.element.dispatchEvent(Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
        pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0, clientX: x, clientY: 100
      }));
      await wrapper.vm.$nextTick();
    };
    try {
      scale(2);
      await dispatch('pointerdown', 250);
      await dispatch('pointerup', 50);
      expect(wrapper.emitted('update:modelValue')).toBeUndefined();
      scale(1);
      await dispatch('pointerdown', 250);
      scale(2);
      await dispatch('pointerup', 50);
      expect(wrapper.emitted('update:modelValue')).toBeUndefined();
      scale(1);
      await dispatch('pointerdown', 250);
      await dispatch('pointerup', 50);
      expect(wrapper.emitted('update:modelValue')).toEqual([[1]]);
    } finally {
      if (descriptor) Object.defineProperty(window, 'visualViewport', descriptor);
      else Reflect.deleteProperty(window, 'visualViewport');
      wrapper.unmount();
    }
  });

  it('shares explicit sound requests with other videos and persists them', async () => {
    const wrapper = mount(CarouselMediaStage, { props: { items: mockItems } });
    const player = wrapper.get('media-player');
    await player.trigger('media-unmute-request');
    expect(useAppStore().videoMuted).toBe(false);
    expect(window.localStorage.getItem('foldergram-video-muted')).toBe('false');

    await player.trigger('media-mute-request');
    expect(useAppStore().videoMuted).toBe(true);
    expect(window.localStorage.getItem('foldergram-video-muted')).toBe('true');
    wrapper.unmount();
  });

  it('keeps the first slide aspect ratio in feeds and lets the viewer contain mixed slide sizes', async () => {
    const items = [
      { ...mockItems[1], imageId: 1, width: 2880, height: 1800 },
      { ...mockItems[1], imageId: 2, width: 1200, height: 1800 }
    ];
    const wrapper = mount(CarouselMediaStage, {
      props: { items, preferPreview: true },
      global: { plugins: [i18n] }
    });
    expect((wrapper.element as HTMLElement).style.aspectRatio).toBe('2880 / 1800');
    await wrapper.setProps({ modelValue: 1 });
    expect((wrapper.element as HTMLElement).style.aspectRatio).toBe('2880 / 1800');
    expect(wrapper.get('img').attributes('src')).toBe(items[1].previewUrl);

    await wrapper.setProps({ fitContainer: true });
    expect((wrapper.element as HTMLElement).style.aspectRatio).toBe('auto');
    expect(wrapper.get('img').attributes('width')).toBe('1200');
    expect(wrapper.get('img').attributes('height')).toBe('1800');
  });
});
