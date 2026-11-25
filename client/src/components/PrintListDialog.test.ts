import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PrintListDialog from './PrintListDialog.vue';
import type { PrintPhoto } from '../utils/print-list';

const photo = (id: number, slideNumber: number | null = null): PrintPhoto => ({
  key: '1:' + id, postId: 1, slideNumber, album: 'Family Event',
  filename: id + '.jpg', thumbnailUrl: '/thumbnails/' + id + '.webp'
});
const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
const shareDescriptor = Object.getOwnPropertyDescriptor(navigator, 'share');
function setNavigator(key: string, value: unknown) {
  Object.defineProperty(navigator, key, { configurable: true, value });
}
function restoreNavigator(key: string, descriptor: PropertyDescriptor | undefined) {
  if (descriptor) Object.defineProperty(navigator, key, descriptor);
  else Reflect.deleteProperty(navigator, key);
}
function mountDialog(photos: PrintPhoto[] = [photo(1), photo(2, 3)]) {
  return mount(PrintListDialog, { props: { photos }, global: { stubs: { ResilientImage: true } } });
}

describe('PrintListDialog', () => {
  enableAutoUnmount(afterEach);
  beforeEach(() => {
    if (!HTMLDialogElement.prototype.showModal) HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    if (!HTMLDialogElement.prototype.close) HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
    setNavigator('clipboard', undefined);
    setNavigator('share', undefined);
  });
  afterEach(() => {
    restoreNavigator('clipboard', clipboardDescriptor);
    restoreNavigator('share', shareDescriptor);
  });

  it('copies only explicitly selected photographs and distinguishes a carousel slide', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigator('clipboard', { writeText });
    const wrapper = mountDialog();
    const button = (label: string) => wrapper.findAll('button').find(b => b.text() === label)!;
    expect(button('Copy list').element.disabled).toBe(true);
    await wrapper.findAll('input[type="checkbox"]')[1]!.setValue(true);
    expect(wrapper.get('textarea').element.value).toBe("I'd love prints of these photographs:\n- Family Event / 2.jpg (post #1, photo 3)");
    expect(writeText).not.toHaveBeenCalled();
    await button('Copy list').trigger('click'); await flushPromises();
    expect(writeText).toHaveBeenCalledExactlyOnceWith(wrapper.get('textarea').element.value);
    expect(wrapper.text()).toContain('List copied.');
    await button('Clear selection').trigger('click');
    expect(button('Copy list').element.disabled).toBe(true);
    expect(wrapper.find('textarea').exists()).toBe(false);
  });

  it('offers manual copy when the browser refuses clipboard access', async () => {
    setNavigator('clipboard', { writeText: vi.fn().mockRejectedValue(new Error('blocked')) });
    const wrapper = mountDialog();
    await wrapper.get('input[type="checkbox"]').setValue(true);
    await wrapper.findAll('button').find(b => b.text() === 'Copy list')!.trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('Select and copy the text above.');
    const field = wrapper.get('textarea').element;
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(field.value.length);
  });

  it('shares only after a user action and keeps selection when the share sheet is cancelled', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError'));
    setNavigator('share', share);
    const wrapper = mountDialog();
    await wrapper.get('input[type="checkbox"]').setValue(true);
    expect(share).not.toHaveBeenCalled();
    await wrapper.findAll('button').find(b => b.text() === 'Share list')!.trigger('click');
    await flushPromises();
    expect(share).toHaveBeenCalledExactlyOnceWith({ text: wrapper.get('textarea').element.value });
    expect(wrapper.text()).not.toContain('Sharing is unavailable.');
    expect(wrapper.get('input[type="checkbox"]').element.checked).toBe(true);
  });

  it('bounds the initial grid and removes selection when a favorite is no longer available', async () => {
    const photos = Array.from({ length: 60 }, (_, i) => photo(i + 1));
    const wrapper = mountDialog(photos);
    expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(48);
    await wrapper.findAll('button').find(b => b.text() === 'Load more')!.trigger('click');
    expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(60);
    await wrapper.findAll('input[type="checkbox"]')[59]!.setValue(true);
    expect(wrapper.get('textarea').element.value).toContain('60.jpg');
    await wrapper.setProps({ photos: photos.slice(0, 59) });
    expect(wrapper.find('textarea').exists()).toBe(false);
  });
});
