import assert from 'node:assert/strict'
import test from 'node:test'
import { runtimePlanImageUri, storedPlanImageRef } from '../src/utils/planImageRefs'

test('iOS の古いコンテナ UUID を保存値から外す', () => {
  assert.equal(
    storedPlanImageRef('file:///var/mobile/Containers/Data/Application/OLD/Documents/plan_images/p1_asset.jpg'),
    'plan_images/p1_asset.jpg',
  )
})

test('保存済み参照を現在の documentDirectory へ付け替える', () => {
  assert.equal(
    runtimePlanImageUri(
      'file:///var/mobile/Containers/Data/Application/OLD/Documents/plan_images/p1_asset.jpg',
      'file:///var/mobile/Containers/Data/Application/NEW/Documents/',
    ),
    'file:///var/mobile/Containers/Data/Application/NEW/Documents/plan_images/p1_asset.jpg',
  )
})

test('公開 URL と管理外のローカル URI は変更しない', () => {
  const remote = 'https://example.test/storage/desk-images/p1.jpg'
  const remoteWithSameFolderName = 'https://example.test/plan_images/p1.jpg'
  const external = 'file:///tmp/picked.jpg'
  assert.equal(storedPlanImageRef(remote), remote)
  assert.equal(runtimePlanImageUri(remote, 'file:///documents/'), remote)
  assert.equal(storedPlanImageRef(remoteWithSameFolderName), remoteWithSameFolderName)
  assert.equal(runtimePlanImageUri(remoteWithSameFolderName, 'file:///documents/'), remoteWithSameFolderName)
  assert.equal(storedPlanImageRef(external), external)
  assert.equal(runtimePlanImageUri(external, 'file:///documents/'), external)
})

test('パストラバーサルを含む相対参照は解決しない', () => {
  const unsafe = 'plan_images/../secret.jpg'
  assert.equal(storedPlanImageRef(unsafe), unsafe)
  assert.equal(runtimePlanImageUri(unsafe, 'file:///documents/'), unsafe)
})
