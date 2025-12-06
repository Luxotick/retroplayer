const express = require('express');
const SpotifyWebApi = require('spotify-web-api-node');
const { getAccessToken, getRecommendSong } = require('./public/spotifyToken');
require('dotenv').config();

const app = express();
const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 8888;
const redirectUri = process.env.REDIRECT_URI || `https://127.0.0.1:${port}/callback`;

if (!process.env.REDIRECT_URI) {
  console.warn(`REDIRECT_URI not set in environment; defaulting to ${redirectUri}. Ensure this URL is registered in the Spotify dashboard.`);
}

const spotifyApi = new SpotifyWebApi({
  clientId: process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET,
  redirectUri
});

const backendTokenState = {
  token: null,
  expiresAt: null,
  inFlight: null
};

async function obtainBackendToken() {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const refreshBufferSeconds = 60;

  if (backendTokenState.token && backendTokenState.expiresAt) {
    if (backendTokenState.expiresAt - refreshBufferSeconds > nowSeconds) {
      return backendTokenState.token;
    }
  }

  if (backendTokenState.inFlight) {
    return backendTokenState.inFlight;
  }

  backendTokenState.inFlight = (async () => {
    const tokenPayload = await getAccessToken({ verifyToken: false }).catch(error => {
      console.error('Unable to refresh backend Spotify token:', error);
      throw error;
    });

    const { accessToken, expiresAt } = tokenPayload || {};

    if (!accessToken) {
      throw new Error('spotifyToken backend did not return an access token');
    }

    backendTokenState.token = accessToken;
    backendTokenState.expiresAt = expiresAt || Math.floor(Date.now() / 1000) + 1800;

    return backendTokenState.token;
  })()
    .finally(() => {
      backendTokenState.inFlight = null;
    });

  return backendTokenState.inFlight;
}

const scopes = [
  'ugc-image-upload',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'streaming',
  'app-remote-control',
  'user-read-email',
  'user-read-private',
  'playlist-read-collaborative',
  'playlist-modify-public',
  'playlist-read-private',
  'playlist-modify-private',
  'user-library-modify',
  'user-library-read',
  'user-top-read',
  'user-read-playback-position',
  'user-read-recently-played',
  'user-follow-read',
  'user-follow-modify'
];

app.use(express.static('public'));
app.use(express.json());

app.get('/login', (req, res) => {
  res.redirect(spotifyApi.createAuthorizeURL(scopes));
});

app.get('/callback', (req, res) => {
  const error = req.query.error;
  const code = req.query.code;

  if (error) {
    console.error('Callback Error:', error);
    res.send(`Callback Error: ${error}`);
    return;
  }

  spotifyApi.authorizationCodeGrant(code).then(data => {
    const access_token = data.body['access_token'];
    const refresh_token = data.body['refresh_token'];
    const expires_in = data.body['expires_in'];

    spotifyApi.setAccessToken(access_token);
    spotifyApi.setRefreshToken(refresh_token);

    console.log('access_token:', access_token);
    console.log('refresh_token:', refresh_token);

    console.log(
      `Sucessfully retreived access token. Expires in ${expires_in} s.`
    );
    
    // Redirect to the main page with tokens in the query string
    res.redirect(`/#access_token=${encodeURIComponent(access_token)}&refresh_token=${encodeURIComponent(refresh_token)}&expires_in=${encodeURIComponent(expires_in)}`);
  }).catch(error => {
    console.error('Error getting Tokens:', error);
    res.send(`Error getting Tokens: ${error}`);
  });
});

app.get('/refresh_token', async (req, res) => {
  const refreshToken = req.query.refresh_token;
  if (!refreshToken) {
    res.status(400).json({ error: 'Missing refresh_token parameter' });
    return;
  }

  try {
    const tempApi = new SpotifyWebApi({
      clientId: process.env.CLIENT_ID,
      clientSecret: process.env.CLIENT_SECRET,
      redirectUri
    });

    tempApi.setRefreshToken(refreshToken);
    const data = await tempApi.refreshAccessToken();

    res.json({
      access_token: data.body['access_token'],
      expires_in: data.body['expires_in']
    });
  } catch (error) {
    console.error('Error refreshing access token:', error);
    res.status(500).json({ error: 'Failed to refresh access token' });
  }
});

function extractToken(req) {
  const header = req.headers['authorization'];
  if (!header) {
    return null;
  }

  const [, token] = header.split(' ');
  return token || null;
}

function createTokenClient(token) {
  const tempApi = new SpotifyWebApi({
    clientId: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    redirectUri
  });
  tempApi.setAccessToken(token);
  return tempApi;
}

function mapTrack(track) {
  if (!track) {
    return null;
  }

  return {
    id: track.id,
    uri: track.uri,
    name: track.name,
    duration_ms: track.duration_ms,
    album: track.album
      ? {
          id: track.album.id,
          name: track.album.name,
          images: track.album.images
        }
      : null,
    artists: Array.isArray(track.artists)
      ? track.artists.map(artist => ({
          id: artist.id,
          name: artist.name
        }))
      : []
  };
}

app.get('/me/playlists', async (req, res) => {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).send('Access token is missing');
  }

  try {
    const tempApi = createTokenClient(token);
    const me = await tempApi.getMe();
    const playlists = await tempApi.getUserPlaylists(me.body.id);
    res.json(playlists.body.items);
  } catch (error) {
    console.error('Error fetching playlists:', error);
    res.status(500).send(`Error fetching playlists: ${error}`);
  }
});

app.get('/playlists/:playlistId/tracks', async (req, res) => {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).send('Access token is missing');
  }

  const { playlistId } = req.params;

  try {
    const tempApi = createTokenClient(token);
    const data = await tempApi.getPlaylistTracks(playlistId, { limit: 100 });
    const tracks = data.body.items
      .map(item => mapTrack(item.track))
      .filter(Boolean);
    res.json({ tracks });
  } catch (error) {
    console.error('Error fetching playlist tracks:', error);
    res.status(500).send(`Error fetching playlist tracks: ${error}`);
  }
});

app.get('/search', async (req, res) => {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).send('Access token is missing');
  }

  const query = req.query.q;
  if (!query) {
    return res.status(400).send('Missing query parameter q');
  }

  try {
    const tempApi = createTokenClient(token);
    const result = await tempApi.searchTracks(query, { limit: 15 });
    const tracks = result.body.tracks?.items
      ? result.body.tracks.items.map(mapTrack).filter(Boolean)
      : [];
    res.json(tracks);
  } catch (error) {
    console.error('Error searching tracks:', error);
    res.status(500).send(`Error searching tracks: ${error}`);
  }
});

app.post('/recommendation', async (req, res) => {
  const trackId = req.body?.trackId;

  if (!trackId) {
    res.status(400).json({ error: 'Missing trackId' });
    return;
  }

  try {
    const token = await obtainBackendToken();
    const payload = await getRecommendSong(token, trackId);
    const mediaItem = Array.isArray(payload?.mediaItems) ? payload.mediaItems[0] : null;
    const playlistUri = mediaItem?.uri;
    const playlistId = typeof playlistUri === 'string' && playlistUri.includes(':')
      ? playlistUri.split(':').pop()
      : null;

    if (!playlistUri || !playlistId) {
      res.status(502).json({ error: 'Recommendation response missing playlist data' });
      return;
    }

    res.json({
      playlistUri,
      playlistId,
      raw: payload
    });
  } catch (error) {
    console.error('Error fetching recommendation playlist:', error);
    res.status(500).json({ error: 'Failed to fetch recommendation playlist' });
  }
});


app.listen(port, () => {
  console.log(`Retro Spotify Player listening at http://localhost:${port}`);
  void obtainBackendToken().catch(() => {});
});
