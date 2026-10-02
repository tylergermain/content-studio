# Office builder

Open **Menu → Office builder**, or press **B**, on an office floor. Layout editing is available to admins. Castle and other custom maps retain their own layouts.

Select one of the 16 main desks, then drag it across the blue work area. Positions snap to a quarter-meter grid. Use the position fields for precise placement and **Rotate 90°** to turn a desk. **Change desk sign** opens the existing sign editor.

The editor checks desk and chair footprints, plants, and the work-area boundary. An occupied desk stays in place until its worker is sent home. Fixed rooms, boards, kitchen, lounge, elevator, and overflow seating stay outside the editable work area.

**Save layout** applies the draft to everyone on the floor, updates desk interaction and collision positions, and refreshes navigation. Layouts persist in that floor's `.agent-office/floorplan.json` across restarts. Closing the editor discards unsaved position changes. **Restore original layout** prepares the original desk arrangement as a draft, which still needs saving. **Reload saved layout** discards the draft and loads the current arrangement. A newer save from another admin blocks a stale draft until it is reloaded.

The back office can grow by two desks per row, up to four additional desks. Expansion and shrinking apply immediately. A row with a worker cannot be removed. Desk signs also save immediately through their own editor.

This version edits main desk positions and uses the existing back-office expansion. It does not add arbitrary walls, rooms, or furniture, and does not increase the existing 20-desk capacity. Worker assignments and terminals keep their stable desk IDs.
