# Touchline

Touchline is a local football tactics board for studio presentation. It opens to a clean, regulation-proportion pitch.

## Run locally

Use Node.js 22 and run `npm ci` followed by `npm run dev`. Open the address printed in the terminal. Run `npm test` for the focused model checks and `npm run build` for type checking and the production build.

## Match data

Choose **Enter match** or **Import JSON** from the match selector to supply data you are entitled to use. The JSON panel lists the fields and can populate the form from the selected fixture. Supply stable fixture, team and player IDs. Lineups require eleven unique players with shirt numbers for each supplied XI. Place players in tactical order, goalkeeper first. The matchday bench and substitution records are separate fields.

The optional server-side Fantasy Premier League adapter supplies current fixtures, completed scores and squad references. Set `ENABLE_FPL=true` only when your use is permitted. It is disabled by default. A squad selection is labelled **Manually selected**. Enter or import the actual XI, bench and substitutions from an authorised matchday source. Mark data as verified only after checking that source and supplying its URL. The board's player positions remain editorial.

Use the **Match state** selector to inspect a recorded minute or enter a custom minute. A substitution inherits the outgoing player's position. Verified substitutions apply across the board. Operator substitutions are saved with the current scene.

## Present a board

- Home attacks to the right. Away attacks to the left. The attacking and defensive views follow the home orientation.
- Use **Group** or Shift to select several players. Drag to reposition them and use the arrow keys for small adjustments. With **Ball**, tap a player to attach it or drag the ball to place it independently.
- Select a mark to edit its style, endpoints or curve. Use **Duplicate Scene** to preserve a setup while building the next moment.
- Use **Import image** to work on a still. **Fit** and **Crop** preserve its aspect ratio and annotation coordinates. Returning to the pitch restores its original annotations.
- **Save** stores the complete board on this device in IndexedDB. **Open** shows the local library. Use the name above the pitch to rename the board, then save the change.
- **ON AIR** uses a clean 16:9 composition. The left and right arrow keys change scenes. Press Escape or double-tap to exit. **Export** downloads the same composition as a 1080p or 4K PNG.
