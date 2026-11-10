# Touchline

Touchline is a local football tactics board for studio presentation. It opens to a clean, regulation-proportion pitch.

## Run locally

Use Node.js 22 and run `npm ci` followed by `npm run dev`. Open the address printed in the terminal. Run `npm test` for the focused model checks and `npm run build` for type checking and the production build.

## Match data

Choose **Enter match** or **Import JSON** from the match selector to supply data you are entitled to use. The JSON panel lists the fields and can populate the form from the selected fixture. Supply stable fixture, team and player IDs. Lineups require eleven unique players with shirt numbers for each supplied XI. Place players in tactical order, goalkeeper first. The matchday bench and substitution records are separate fields.

The default keyless fixture source is OpenFootball’s CC0 Premier League 2026/27 schedule. Its results coverage can lag, and the selector displays the latest available final and the number of past fixtures missing scores. Supply lineups separately. A configured server-side fixture feed takes priority. For Football-Data.org, set `MATCH_DATA_PROVIDER=football-data.org` and `FOOTBALL_DATA_API_TOKEN` using a token for this application. If you have separate permission to use Fantasy Premier League data, set `MATCH_DATA_PROVIDER=fpl` instead. Set `MATCH_DATA_USE_AUTHORISED=true` only once the selected provider permits your intended use. Configure these values on the server or in Vercel Production settings. A squad selection is labelled **Manually selected**. Enter or import the actual XI, bench and substitutions from an authorised matchday source. Mark data as verified only after checking that source and supplying its URL. The board's player positions remain editorial.

Use the **Match state** selector to inspect a recorded minute or enter a custom minute. A substitution inherits the outgoing player's position. Verified substitutions apply across the board. Operator substitutions are saved with the current scene.

## Present a board

- Home attacks to the right. Away attacks to the left. The attacking and defensive views follow the home orientation.
- Use **Group** or Shift to select several players. Drag to reposition them and use the arrow keys for small adjustments. With **Ball**, tap a player to attach it or drag the ball to place it independently.
- Select a mark to edit its style, endpoints or curve. Use **Duplicate Scene** to preserve a setup while building the next moment. The scene action arrows move the active scene earlier or later.
- Use **Import image** to work on a still. **Fit** and **Crop** preserve its aspect ratio and annotation coordinates. Returning to the pitch restores its original annotations.
- **Save** stores the complete board on this device in IndexedDB. **Open** shows the local library. Use the name above the pitch to rename the board, then save the change. **Download board file** in the library bundles the editable board and any stills. On the next device, use **Import board file** to save a separate copy.
- **ON AIR** uses a clean 16:9 composition. Use the left and right arrow keys or swipe on a tablet to change scenes. Space toggles the current scene’s annotations. Press Escape or double-tap to exit. **Export** downloads the same composition as a 1080p or 4K PNG.

### Keyboard controls

Tool shortcuts are **V** Select, **R** Run, **P** Pass, **C** Carry, **D** Draw, **S** Shape, **H** Highlight, **E** Erase and **B** Ball. Tab to the board in Select mode. Enter or Shift+Enter cycles visible objects, arrow keys nudge, and Shift+arrows move farther. Space attaches or detaches the ball on a selected player. Delete removes a selected mark or ball. Escape clears selection.
