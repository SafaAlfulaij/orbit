import { Orbit } from '@orbit/core';
import { FullResponse, ResponseHints } from '@orbit/data';
import {
  InitializedRecord,
  RecordKeyMap,
  RecordOperation,
  RecordSchema,
  RecordTransform,
  RecordTransformResult
} from '@orbit/records';
import { IndexedDBSource } from '../src/indexeddb-source';

const { module, test } = QUnit;

module('IndexedDBSource - updatable', function (hooks) {
  let schema: RecordSchema, source: IndexedDBSource, keyMap: RecordKeyMap;

  hooks.beforeEach(async () => {
    schema = new RecordSchema({
      models: {
        star: {
          attributes: {
            name: { type: 'string' }
          },
          relationships: {
            planets: { kind: 'hasMany', type: 'planet', inverse: 'star' }
          }
        },
        planet: {
          attributes: {
            name: { type: 'string' },
            classification: { type: 'string' }
          },
          relationships: {
            moons: { kind: 'hasMany', type: 'moon', inverse: 'planet' },
            star: { kind: 'hasOne', type: 'star', inverse: 'planets' }
          }
        },
        moon: {
          attributes: {
            name: { type: 'string' }
          },
          relationships: {
            planet: { kind: 'hasOne', type: 'planet', inverse: 'moons' }
          }
        },
        binaryStar: {
          attributes: {
            name: { type: 'string' }
          },
          relationships: {
            starOne: { kind: 'hasOne', type: 'star' },
            starTwo: { kind: 'hasOne', type: 'star' }
          }
        },
        planetarySystem: {
          attributes: {
            name: { type: 'string' }
          },
          relationships: {
            star: { kind: 'hasOne', type: ['star', 'binaryStar'] },
            bodies: { kind: 'hasMany', type: ['planet', 'moon'] }
          }
        }
      }
    });

    keyMap = new RecordKeyMap();

    source = new IndexedDBSource({ schema, keyMap });
    await source.activated;
  });

  hooks.afterEach(async () => {
    await source.deactivate();
    await source.cache.deleteDB();
  });

  hooks.afterEach(() => {
    return source.reset().then(() => {
      Orbit.globals.localStorage.removeItem('orbit-bucket/foo');
    });
  });

  test("#update - transforms the source's cache", async function (assert) {
    assert.expect(4);

    const jupiter: InitializedRecord = {
      id: 'jupiter',
      type: 'planet',
      attributes: { name: 'Jupiter', classification: 'gas giant' }
    };

    assert.equal(
      (await source.cache.getRecordsAsync('planet')).length,
      0,
      'cache should start empty'
    );

    let record = await source.update((t) => t.addRecord(jupiter));

    assert.equal(
      (await source.cache.getRecordsAsync('planet')).length,
      1,
      'cache should contain one planet'
    );
    assert.deepEqual(
      await source.cache.getRecordAsync({ type: 'planet', id: 'jupiter' }),
      jupiter,
      'planet should be jupiter'
    );
    assert.strictEqual(record, jupiter, 'result should be returned');
  });

  test('#update - catches errors', async function (assert) {
    assert.expect(2);

    assert.equal(
      (await source.cache.getRecordsAsync('planet')).length,
      0,
      'cache should contain no planets'
    );

    try {
      await source.update(
        (t) => t.removeRecord({ type: 'planet', id: 'jupiter' }),
        { raiseNotFoundExceptions: true }
      );
    } catch (e) {
      assert.equal(e.message, 'Record not found: planet:jupiter');
    }
  });

  test('#update - can perform multiple operations and return the results', async function (assert) {
    assert.expect(3);

    const jupiter: InitializedRecord = {
      type: 'planet',
      id: 'jupiter',
      attributes: { name: 'Jupiter', classification: 'gas giant' }
    };

    const earth: InitializedRecord = {
      type: 'planet',
      id: 'earth',
      attributes: { name: 'Earth', classification: 'terrestrial' }
    };

    assert.equal(
      (await source.cache.getRecordsAsync('planet')).length,
      0,
      'cache should start empty'
    );

    let records = await source.update((t) => [
      t.addRecord(jupiter),
      t.addRecord(earth)
    ]);

    assert.equal(
      (await source.cache.getRecordsAsync('planet')).length,
      2,
      'cache should contain two planets'
    );
    assert.deepEqual(
      records,
      [jupiter, earth],
      'results array should be returned'
    );
  });

  test('#update - replaceRelatedRecord can be followed up by removing the replaced record', async function (assert) {
    assert.expect(2);

    const star1 = {
      id: 'star1',
      type: 'star',
      attributes: { name: 'sun' }
    };

    const star2 = {
      id: 'star2',
      type: 'star',
      attributes: { name: 'sun2' }
    };

    const home = {
      id: 'home',
      type: 'planetarySystem',
      attributes: { name: 'Home' },
      relationships: {
        star: {
          data: { id: 'star1', type: 'star' }
        }
      }
    };

    await source.update((t) => [
      t.addRecord(star1),
      t.addRecord(star2),
      t.addRecord(home)
    ]);

    let latestHome = await source.cache.getRecordAsync({
      id: 'home',
      type: 'planetarySystem'
    });
    assert.deepEqual(
      (latestHome?.relationships?.star.data as InitializedRecord).id,
      star1.id,
      'The original related record is in place.'
    );

    await source.update((t) => [
      t.replaceRelatedRecord(home, 'star', star2),
      t.removeRecord(star1)
    ]);

    latestHome = await source.cache.getRecordAsync({
      id: 'home',
      type: 'planetarySystem'
    });
    assert.deepEqual(
      (latestHome?.relationships?.star.data as InitializedRecord).id,
      star2.id,
      'The related record was replaced.'
    );
  });

  test('#update - accepts hints that can return a single record', async function (assert) {
    assert.expect(2);

    let jupiter = {
      id: 'jupiter',
      type: 'planet',
      attributes: { name: 'Jupiter' }
    };

    let earth = {
      id: 'earth',
      type: 'planet',
      attributes: { name: 'Earth' }
    };

    await source.cache.update((t) => t.addRecord(earth));

    source.on('beforeUpdate', (transform: RecordTransform, hints: any) => {
      if (transform?.options?.customizeResults) {
        hints.data = earth;
      }
    });

    let planet = await source.update((t) => t.addRecord(jupiter), {
      customizeResults: true
    });

    assert.equal(
      (await source.cache.getRecordsAsync('planet')).length,
      2,
      'cache should contain two planets'
    );

    assert.deepEqual(planet, earth, 'added planet matches hinted record');
  });

  test('#update - accepts hints that can return a collection of records', async function (assert) {
    assert.expect(2);

    let jupiter = {
      id: 'jupiter',
      type: 'planet',
      attributes: { name: 'Jupiter' }
    };

    let earth = {
      id: 'earth',
      type: 'planet',
      attributes: { name: 'Earth' }
    };

    let uranus = {
      id: 'uranus',
      type: 'planet',
      attributes: { name: 'Uranus' }
    };

    source.on(
      'beforeUpdate',
      (
        transform: RecordTransform,
        hints: ResponseHints<RecordTransformResult, unknown>
      ) => {
        if (transform?.options?.customizeResults) {
          hints.data = [
            { type: 'planet', id: 'uranus' },
            { type: 'planet', id: 'jupiter' }
          ];
        }
      }
    );

    let planets = await source.update(
      (t) => [t.addRecord(jupiter), t.addRecord(earth), t.addRecord(uranus)],
      {
        customizeResults: true
      }
    );

    assert.equal(
      (await source.cache.getRecordsAsync('planet')).length,
      3,
      'cache should contain three planets'
    );

    assert.deepEqual(
      planets,
      [uranus, jupiter],
      'planets match hinted records'
    );
  });

  test('#update - accepts hints that can return an array of varied results', async function (assert) {
    assert.expect(2);

    let jupiter = {
      id: 'jupiter',
      type: 'planet',
      attributes: { name: 'Jupiter' }
    };

    let earth = {
      id: 'earth',
      type: 'planet',
      attributes: { name: 'Earth' }
    };

    let uranus = {
      id: 'uranus',
      type: 'planet',
      attributes: { name: 'Uranus' }
    };

    source.on(
      'beforeUpdate',
      (
        transform: RecordTransform,
        hints: ResponseHints<RecordTransformResult, unknown>
      ) => {
        if (transform?.options?.customizeResults) {
          hints.data = [
            { type: 'planet', id: 'uranus' },
            { type: 'planet', id: 'earth' },
            undefined
          ];
          hints.details = {
            foo: 'bar'
          };
        }
      }
    );

    let planets = await source.update(
      (t) => [t.addRecord(jupiter), t.addRecord(earth), t.addRecord(uranus)],
      {
        customizeResults: true
      }
    );

    assert.equal(
      (await source.cache.getRecordsAsync('planet')).length,
      3,
      'cache should contain three planets'
    );

    assert.deepEqual(
      planets,
      [uranus, earth, undefined],
      'planets match hinted records'
    );
  });

  test('#update - hint details can be returned in a full response', async function (assert) {
    assert.expect(2);

    let jupiter = {
      id: 'jupiter',
      type: 'planet',
      attributes: { name: 'Jupiter' }
    };

    let earth = {
      id: 'earth',
      type: 'planet',
      attributes: { name: 'Earth' }
    };

    let uranus = {
      id: 'uranus',
      type: 'planet',
      attributes: { name: 'Uranus' }
    };

    source.on(
      'beforeUpdate',
      (
        transform: RecordTransform,
        hints: ResponseHints<RecordTransformResult, unknown>
      ) => {
        hints.data = [
          { type: 'planet', id: 'uranus' },
          { type: 'planet', id: 'earth' }
        ];
        hints.details = {
          foo: 'bar'
        };
      }
    );

    let { data, details } = (await source.update(
      (t) => [t.addRecord(jupiter), t.addRecord(earth), t.addRecord(uranus)],
      {
        fullResponse: true
      }
    )) as FullResponse<RecordTransformResult, unknown, RecordOperation>;

    assert.deepEqual(data, [uranus, earth], 'data matches hinted data');
    assert.deepEqual(details, { foo: 'bar' }, 'details match hinted details');
  });
});
