const crypto = require('crypto');

const REQUEST_TIMEOUT_MS = 20000;

/**
 * Song recognition through the ACRCloud Identification API (signature version 1).
 * Uses Node's built-in fetch/FormData, so there are no third-party HTTP dependencies.
 * Docs: https://docs.acrcloud.com/tutorials/recognize-music
 */
class ACRCloudService {
  constructor() {
    this.host = process.env.ACRCLOUD_HOST || 'identify-us-west-2.acrcloud.com';
    this.accessKey = process.env.ACRCLOUD_ACCESS_KEY;
    this.accessSecret = process.env.ACRCLOUD_ACCESS_SECRET;
    this.endpoint = '/v1/identify';
    this.signatureVersion = '1';
    this.dataType = 'audio';
    // No audio format is specified: ACRCloud detects it from the sample
  }

  /**
   * Signs a request: base64(HMAC-SHA1(secret, method\nuri\naccess_key\ndata_type\nsignature_version\ntimestamp))
   * @param {string} timestamp - Unix time in seconds
   * @returns {string}
   */
  sign(timestamp) {
    const stringToSign = ['POST', this.endpoint, this.accessKey, this.dataType, this.signatureVersion, timestamp].join('\n');
    return crypto.createHmac('sha1', this.accessSecret).update(stringToSign, 'utf8').digest('base64');
  }

  /**
   * Sends an audio sample to ACRCloud and returns the raw JSON response
   * @param {Buffer} audioBuffer
   * @returns {Promise<Object>}
   */
  async request(audioBuffer) {
    const timestamp = String(Math.floor(Date.now() / 1000));

    const form = new FormData();
    form.append('sample', new Blob([audioBuffer]), 'sample');
    form.append('sample_bytes', String(audioBuffer.length));
    form.append('access_key', this.accessKey);
    form.append('data_type', this.dataType);
    form.append('signature_version', this.signatureVersion);
    form.append('signature', this.sign(timestamp));
    form.append('timestamp', timestamp);

    const response = await fetch(`https://${this.host}${this.endpoint}`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });

    if (!response.ok) {
      throw new Error(`ACRCloud responded with HTTP ${response.status}`);
    }
    return response.json();
  }

  /**
   * Identify a song from audio buffer
   * @param {Buffer} audioBuffer - Audio data (WAV, WebM/Opus, MP3... ACRCloud detects the format)
   * @returns {Promise<Object>} Song information
   */
  async identify(audioBuffer) {
    try {
      const result = await this.request(audioBuffer);
      const status = result.status || {};

      if (status.code === 0 && result.metadata && result.metadata.music && result.metadata.music.length > 0) {
        const song = result.metadata.music[0];

        return {
          success: true,
          song: {
            title: song.title || 'Unknown',
            artist: song.artists ? song.artists.map(a => a.name).join(', ') : 'Unknown',
            album: song.album ? song.album.name : null,
            releaseDate: song.release_date || null,
            duration: song.duration_ms || null,
            label: song.label || null,
            genres: song.genres ? song.genres.map(g => g.name) : [],
            externalIds: {
              spotify: song.external_ids?.spotify || null,
              isrc: song.external_ids?.isrc || null,
              youtube: song.external_metadata?.youtube?.vid || null
            },
            externalMetadata: song.external_metadata || {},
            score: status.score || 0
          },
          timestamp: new Date().toISOString()
        };
      } else {
        return {
          success: false,
          error: 'No match found',
          message: status.msg || 'Could not identify the song'
        };
      }
    } catch (error) {
      console.error('ACRCloud identification error:', error);
      return {
        success: false,
        error: 'Recognition failed',
        message: error.message
      };
    }
  }

  /**
   * Check if service is configured
   * @returns {boolean}
   */
  isConfigured() {
    return !!(process.env.ACRCLOUD_ACCESS_KEY && process.env.ACRCLOUD_ACCESS_SECRET);
  }
}

module.exports = ACRCloudService;
