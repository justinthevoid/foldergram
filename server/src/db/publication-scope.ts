import { AsyncLocalStorage } from 'node:async_hooks';

// Background indexing always sees the complete library. HTTP requests get an
// explicit access scope; share requests never inherit the administrator's view.
const access = new AsyncLocalStorage<boolean>();
export const publicationOwner = () => access.getStore() !== false;
export function withPublicationAccess<T>(owner: boolean, action: () => T): T {
  return access.run(owner, action);
}

export function unpublishedPostSql(id: string) {
  return `EXISTS (SELECT 1 FROM post_publications AS release WHERE release.post_id=${id}
    AND (release.published_at IS NULL OR release.published_at > publication_now()))`;
}
export function visiblePublicationImageSql(alias: string) {
  return `(publication_owner() = 1 OR NOT EXISTS (
    SELECT 1 FROM post_items AS publication_item
    JOIN post_publications AS release ON release.post_id=publication_item.post_id
    WHERE publication_item.image_id=${alias}.id
      AND (release.published_at IS NULL OR release.published_at > publication_now())
  ))`;
}
export function visiblePublicationPostSql(alias: string) {
  return `(publication_owner() = 1 OR (
    NOT ${unpublishedPostSql(alias+'.id')}
    AND NOT EXISTS (
      SELECT 1 FROM post_items AS visible_item
      JOIN post_items AS related_item ON related_item.image_id=visible_item.image_id
      JOIN post_publications AS release ON release.post_id=related_item.post_id
      WHERE visible_item.post_id=${alias}.id
        AND (release.published_at IS NULL OR release.published_at > publication_now())
    )
  ))`;
}
export const publicationDateSql = '(SELECT published_at FROM post_publications WHERE post_id=posts.id AND published_at <= publication_now())';
export const publicationFeaturedSql = 'COALESCE((SELECT featured FROM post_publications WHERE post_id=posts.id AND published_at <= publication_now()),0)';