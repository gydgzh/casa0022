// MediaPipe FaceLandmarker wrapper.
// Returns 52 ARKit-compatible blendshape coefficients + head/face transform.
// Apache-2.0 licensed (Google).

import { FilesetResolver, FaceLandmarker } from '@mediapipe/tasks-vision';

const WASM_BASE =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

export class FaceCapture {
  constructor() {
    this.landmarker = null;
    this.lastVideoTime = -1;
    this.lastBlendshapes = null;
    this.lastTransform = null;
  }

  async init() {
    const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
    this.landmarker = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true
    });
    return this;
  }

  /**
   * @param {HTMLVideoElement} video
   * @param {number} timestampMs
   * @returns {{blendshapes: Record<string, number>|null, transform: Float32Array|null}}
   */
  detect(video, timestampMs) {
    if (!this.landmarker || video.currentTime === this.lastVideoTime) {
      return { blendshapes: this.lastBlendshapes, transform: this.lastTransform };
    }
    this.lastVideoTime = video.currentTime;
    const res = this.landmarker.detectForVideo(video, timestampMs);

    if (res.faceBlendshapes && res.faceBlendshapes.length > 0) {
      const dict = {};
      for (const c of res.faceBlendshapes[0].categories) {
        dict[c.categoryName] = c.score;
      }
      this.lastBlendshapes = dict;
    }
    if (res.facialTransformationMatrixes && res.facialTransformationMatrixes.length > 0) {
      this.lastTransform = res.facialTransformationMatrixes[0].data;
    }
    return { blendshapes: this.lastBlendshapes, transform: this.lastTransform };
  }

  dispose() {
    this.landmarker?.close();
    this.landmarker = null;
  }
}
