import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { assetUrl, type AssetDomain } from './assetManifest';

/** Caches one immutable GLTF template per asset, then returns deep clones. This keeps
 * repeated vegetation/props cheap and prevents material mutations on damage/paint from
 * leaking into another instance. */
export class AssetLibrary {
  private readonly loader = new GLTFLoader();
  private readonly templates = new Map<string, Promise<THREE.Group>>();

  load(domain: AssetDomain, id: string): Promise<THREE.Group> {
    const key = `${domain}:${id}`;
    let template = this.templates.get(key);
    if (!template) {
      template = new Promise<THREE.Group>((resolve, reject) => {
        this.loader.load(assetUrl(domain, id), (gltf) => resolve(gltf.scene), undefined, reject);
      });
      this.templates.set(key, template);
    }
    return template.then((source) => source.clone(true));
  }
}

export const assetLibrary = new AssetLibrary();
