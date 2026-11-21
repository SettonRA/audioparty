using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace AudioPartyDesktop;

/// <summary>Plain-language guide to hosting and joining a party.</summary>
public partial class HelpWindow : Window
{
    private static readonly Brush Primary = new SolidColorBrush(Color.FromRgb(0x63, 0x66, 0xF1));
    private static readonly Brush Text = new SolidColorBrush(Color.FromRgb(0xF1, 0xF5, 0xF9));
    private static readonly Brush Muted = new SolidColorBrush(Color.FromRgb(0x94, 0xA3, 0xB8));

    public HelpWindow()
    {
        InitializeComponent();

        AddHeading("Hosting a party");
        AddStep("1.", "Start playing audio in the app you want to share (Spotify, VLC, a browser, a game...).");
        AddStep("2.", "Pick that app under Audio Source. Only apps that are playing audio right now are listed; press ↻ if yours is missing. Only that app's sound is shared. Other apps and notifications stay private.");
        AddStep("3.", "Click Start Hosting. You get a room code.");
        AddStep("4.", "Send the code or link to your friends with Copy Code / Copy Link. They can join from any web browser or from this app. Up to 10 people can be in a party, including you.");

        AddHeading("While you're hosting");
        AddBullet("Song detection runs automatically and shows the current song to everyone in the party.");
        AddBullet("Share on Discord posts a now-playing message with a join button to the AudioParty Discord and keeps it updated as songs change.");
        AddBullet("Relay status shows whether the relay server is online. It helps friends on strict networks connect.");
        AddBullet("End Party closes the room for everyone.");
        AddBullet("If the app you're sharing is closed or paused, listeners hear silence until it plays again.");

        AddHeading("Joining a party");
        AddStep("1.", "Type the room code, or paste the party link, into Join a Party and click Join (or press Enter).");
        AddStep("2.", "Audio plays on your default output device. Use the volume slider to adjust it, and Leave Party when you're done.");

        AddHeading("Good to know");
        AddBullet("Parties end automatically after 6 hours.");
        AddBullet("Sharing a single app needs Windows 10 (version 2004) or newer.");
        AddBullet("If you lose your connection to the server while listening, the app reconnects and rejoins on its own.");
    }

    private void AddHeading(string heading) =>
        HelpBody.Children.Add(new TextBlock
        {
            Text = heading.ToUpperInvariant(),
            Foreground = Primary,
            FontSize = 12,
            FontWeight = FontWeights.Bold,
            Margin = new Thickness(0, HelpBody.Children.Count == 0 ? 0 : 20, 0, 8)
        });

    private void AddStep(string number, string text) => AddRow(number, text, 22);

    private void AddBullet(string text) => AddRow("•", text, 14);

    private void AddRow(string marker, string text, double markerWidth)
    {
        var grid = new Grid { Margin = new Thickness(0, 0, 0, 6) };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(markerWidth) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        grid.Children.Add(new TextBlock { Text = marker, Foreground = Muted, FontSize = 13 });

        var body = new TextBlock { Text = text, Foreground = Text, FontSize = 13, TextWrapping = TextWrapping.Wrap };
        Grid.SetColumn(body, 1);
        grid.Children.Add(body);

        HelpBody.Children.Add(grid);
    }

    private void CloseButton_Click(object sender, RoutedEventArgs e) => Close();
}
