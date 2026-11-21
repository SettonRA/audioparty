using System.Windows;
using System.Windows.Controls;
using AudioPartyDesktop.Services;

namespace AudioPartyDesktop;

/// <summary>Shows the current song (or detection status). Shared by the host and listener screens.</summary>
public partial class SongPanel : UserControl
{
    /// <summary>Text shown before any song is known.</summary>
    public string IdleText { get; set; } = "🎵 Listening for songs...";

    public SongPanel()
    {
        InitializeComponent();
        Loaded += (_, _) => { if (string.IsNullOrEmpty(StatusText.Text)) Reset(); };
    }

    public void Reset() => Show(new SongState(SongStatus.Listening));

    public void Show(SongState state)
    {
        bool hasSong = state.Status == SongStatus.Success;
        TitleText.Visibility = ArtistText.Visibility = hasSong ? Visibility.Visible : Visibility.Collapsed;
        AlbumText.Visibility = hasSong && state.Album is not null ? Visibility.Visible : Visibility.Collapsed;
        StatusText.Visibility = hasSong ? Visibility.Collapsed : Visibility.Visible;

        switch (state.Status)
        {
            case SongStatus.Success:
                TitleText.Text = state.Title;
                ArtistText.Text = state.Artist;
                AlbumText.Text = state.Album;
                break;
            case SongStatus.Detecting:
                StatusText.Text = "🎵 Detecting song...";
                break;
            case SongStatus.NotFound:
                StatusText.Text = "🎵 No song detected";
                break;
            case SongStatus.Error:
                StatusText.Text = $"❌ {state.Message ?? "Detection error"}";
                break;
            default:
                StatusText.Text = IdleText;
                break;
        }
    }
}
