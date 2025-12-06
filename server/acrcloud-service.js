const acrcloud = require('acrcloud');

class ACRCloudService {
  constructor() {
    this.acr = new acrcloud({
      host: process.env.ACRCLOUD_HOST || 'identify-us-west-2.acrcloud.com',
      access_key: process.env.ACRCLOUD_ACCESS_KEY,
      access_secret: process.env.ACRCLOUD_ACCESS_SECRET,
      data_type: 'audio',
      audio_format: 'wav'
    });
  }

  /**
   * Identify a song from audio buffer
   * @param {Buffer} audioBuffer - Audio data in PCM format
   * @returns {Promise<Object>} Song information
   */
  async identify(audioBuffer) {
    try {
      const result = await this.acr.identify(audioBuffer);
      
      if (result.status.code === 0 && result.metadata && result.metadata.music && result.metadata.music.length > 0) {
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
            score: result.status.score || 0
          },
          timestamp: new Date().toISOString()
        };
      } else {
        return {
          success: false,
          error: 'No match found',
          message: result.status.msg || 'Could not identify the song'
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
