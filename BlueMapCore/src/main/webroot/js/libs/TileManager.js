/*
 * This file is part of BlueMap, licensed under the MIT License (MIT).
 *
 * Copyright (c) Blue (Lukas Rieger) <https://bluecolored.de>
 * Copyright (c) contributors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

import { Vector2 } from 'three';

import Tile from './Tile.js';

import { hashTile } from './utils.js';

export default class TileManager {
	constructor(blueMap, viewDistance, tileLoader, scene, tileSize, tileOffset, position) {
		this.blueMap = blueMap;
		this.tileSize = new Vector2(tileSize.x, tileSize.z);
		this.tileOffset = new Vector2(tileOffset.x, tileOffset.z);
		this.setViewDistance(viewDistance);
		this.tileLoader = tileLoader;
		this.scene = scene;

		this.tile = new Vector2(0, 0);
		this.tile.set(position.x, position.z).divide(this.tileSize).floor();
		this.lastTile = this.tile.clone();

		this.closed = false;
		this.currentlyLoading = 0;
		this.updateTimeout = null;

		this.tiles = {};
	}

	setViewDistance(viewDistance){
		this.viewDistanceX = viewDistance / this.tileSize.x;
		this.viewDistanceZ = viewDistance / this.tileSize.y;
	}

	setPosition(center) {
		this.tile.set(center.x, center.z).sub(this.tileOffset).divide(this.tileSize).floor();

		if (!this.tile.equals(this.lastTile) && !this.closed) {
			this.update();
			this.lastTile.copy(this.tile);
		}
	}

	update() {
		if (this.closed) return;

		// free a loader so if there was an error loading a tile we don't get stuck forever with the blocked loading process
		this.currentlyLoading--;
		if (this.currentlyLoading < 0) this.currentlyLoading = 0;

		this.removeFarTiles();
		this.loadCloseTiles();
	}

	removeFarTiles() {
		let keys = Object.keys(this.tiles);
		for (let i = 0; i < keys.length; i++) {
			if (!this.tiles.hasOwnProperty(keys[i])) continue;

			let tile = this.tiles[keys[i]];

			let vdx = this.viewDistanceX;
			let vdz = this.viewDistanceZ;

			if (
				tile.x + vdx < this.tile.x ||
				tile.x - vdx > this.tile.x ||
				tile.z + vdz < this.tile.y ||
				tile.z - vdz > this.tile.y
			) {
				tile.disposeModel();
				delete this.tiles[keys[i]];

				this.blueMap.updateFrame = true;
			}
		}
	}

	removeAllTiles() {
		let keys = Object.keys(this.tiles);
		for (let i = 0; i < keys.length; i++) {
			if (!this.tiles.hasOwnProperty(keys[i])) continue;

			let tile = this.tiles[keys[i]];
			tile.disposeModel();
			delete this.tiles[keys[i]];
		}

		this.blueMap.updateFrame = true;
	}

	close() {
		this.closed = true;
		this.removeAllTiles();
	}

	loadCloseTiles() {
		if (this.closed) return;

		if (this.currentlyLoading < 8) {
			if (!this.loadNextTile()) return;
		}

		if (this.updateTimeout) clearTimeout(this.updateTimeout);
		this.updateTimeout = setTimeout(() => this.loadCloseTiles(), 0);
	}

	loadNextTile() {
		let x = 0;
		let z = 0;
		let d = 1;
		let m = 1;

		while (m < Math.max(this.viewDistanceX, this.viewDistanceZ) * 2 + 1) {
			while (2 * x * d < m) {
				if (this.tryLoadTile(this.tile.x + x, this.tile.y + z)) return true;
				x = x + d;
			}
			while (2 * z * d < m) {
				if (this.tryLoadTile(this.tile.x + x, this.tile.y + z)) return true;
				z = z + d;
			}
			d = -1 * d;
			m = m + 1;
		}

		return false;
	}

	tryLoadTile(x, z) {
		if (this.closed) return false;
		if (Math.abs(x - this.tile.x) > this.viewDistanceX) return false;
		if (Math.abs(z - this.tile.z) > this.viewDistanceZ) return false;

		let tileHash = hashTile(x, z);

		let tile = this.tiles[tileHash];
		if (tile !== undefined) return false;

		tile = new Tile(this.scene, x, z);
		tile.isLoading = true;

		this.currentlyLoading++;

		this.tiles[tileHash] = tile;

		this.tileLoader.call(this.blueMap, x, z)
			.then(model => {
				tile.isLoading = false;

				if (tile.disposed || this.closed) {
					model.geometry.dispose();
					tile.disposeModel();
					delete this.tiles[tileHash];
					return;
				}

				this.tiles[tileHash] = tile;
				tile.setModel(model);

				this.blueMap.updateFrame = true;

				this.currentlyLoading--;
				if (this.currentlyLoading < 0) this.currentlyLoading = 0;
			}).catch(error => {
				tile.isLoading = false;
				tile.disposeModel();

				this.currentlyLoading--;

				//console.log("Failed to load tile: ", x, z);
			});

		return true;
	}
}
