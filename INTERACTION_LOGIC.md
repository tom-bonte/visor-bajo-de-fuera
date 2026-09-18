# 📋 Interaction Logic & Plazas Management Workflows — Visor Bajo de Fuera

> **Note:** This document is **100% editable**. You can modify any step, add business rules, or change behaviors, then send it back to me to implement the exact code changes.

> **Admin Rule:** Admin actions never send WhatsApp messages and are never written to the history log.

---

## 0. Data Model Rule: One Plazas Record per School per Day
- **Single Record per Day:** Each dive school has at most **ONE plazas record per day**: `{ date, centerCode, plazas, note, updatedAt }`.
- **Calendar Display in Boxes (Max 12):** The calendar visualizes a school's plazas in boxes of maximum 12:
  - Up to 12 plazas = **1 box**.
  - 13–24 plazas = **2 boxes** (e.g. 20 plazas = a 12 box + an 8 box).
  - 25–36 plazas = **3 boxes**, and so on.
  - **Boxes are display only.** They are not separate records.
- **No School Maximum:** A school has no maximum plazas per day other than the overall daily quota.
- **Example:** Mangamar has 5 plazas and adds 3 → Mangamar now has 8 plazas, shown as one box. If Mangamar then adds 6 more → 14 plazas, shown as a 12 box and a 2 box.
- **Additive Principle:** Every time plazas are added to a school on a day (adding new plazas, moving, swapping, accepted request, cesión directa), they are **ADDED to that school's existing total**. Nothing ever creates a second record for the same school on the same day.

### 0.1 Daily Quota Source: `getDayQuota(date)`
- **June 1 – September 30:** 30 spots every day.
- **October 1 – October 15:** 30 spots on Saturdays and Sundays only (Fridays stay at 13).
- **Every other day of the year:** 13 spots.
- **Public holidays / puentes do NOT change the quota.**
- **October 15 is a strict cutoff:** if Oct 15 is a Saturday, Sunday Oct 16 is 13 spots.
- **Admin per-date override (e.g. closure = 0)** takes precedence.
- **Always 3-column CSV:** `fecha, centro, plazas`. If a CSV has several rows for the same school and date, their plazas are summed. Daily quota is computed dynamically everywhere (popups, validations, day headers, stats) from `getDayQuota(date)` without saving redundant quota columns.

---

## 1. Double-Click on Empty Space of a Day Cell
**Goal:** Add plazas to a dive school on that date.

### A. Prerequisites & Permissions
- **Guest Mode (Not logged in):** Opens the login modal (`login-modal`).
- **Logged-in Dive Center:** Center selector is locked to their own center.
- **Administrator (Root):** Can select any dive school from the dropdown.

### B. Capacity Validations & Popups (Visor-Reserva Modal Style)
1. **Day Completely Full (`plazas_libres <= 0`):**
   - Does **NOT** open the add plazas wizard.
   - Shows **Centered "Cupo Lleno" Modal**:
     > **Title:** Cupo Lleno  
     > **Message:** *No spots available for this day in Bajo de Fuera (maximum daily quota of [dayQuota] spots reached).*  
     > **Button:** `[Entendido]`

2. **Day with Available Capacity (`plazas_libres > 0`):**
   - Opens the **Add Plazas Wizard Modal**.
   - If the school already has plazas that day, the new plazas will be added to its existing total.
   - **Maximum spots allowed in input:** `plazas_libres` (no 12 limit, since more than 12 simply displays in additional boxes of max 12).
   - **Helper text:** `Available spots today: X`.
   - **If user types a number higher than available capacity:**
     - Shows centered popup modal:
       > **Title:** Plazas Insuficientes  
       > **Message:** *Only X spots available today in Bajo de Fuera. Cannot assign Y plazas.*  
       > **Button:** `[Aceptar]`
   - **If the number is valid (`1 <= plazas <= plazas_libres`):**
     - **Admin:** Saves immediately in memory and Firestore (0ms) without confirmation or WhatsApp. If the school already has plazas that day, the new plazas are added to its total.
     - **Dive Center:** Opens WhatsApp confirmation modal with preformatted message: `"[School] added [X] plazas (total [T] plazas)"`. Clicking "Confirmar" adds the plazas to the school's total and dispatches the webhook.

---

## 2. Double-Click on Own Box (Center) or Any Box (Admin)
**Goal:** Edit plazas, change dive center (admin only), or delete the school's plazas for that day.

### A. Locking Check (Pending Requests / Swaps)
- A pending request, cesión, or swap locks that **school's plazas for that day** (all its boxes that day show `⏳`):
  - **What is blocked:** A lock only blocks **REDUCING, deleting, or moving** that school's plazas on that day.
  - **What is allowed:** Plazas can still be **ADDED** to a locked school's total that day (adding plazas via Section 1, moving its plazas from another day onto it, receiving a cesión or swap, or an admin reassignment). For spot requests and cesiones, the pending request stays valid because the school's plazas can only grow. For swaps, any change in either school's total makes the proposal invalid at acceptance (see Section 5, Case 4, step 7).
  - Double-clicking any of that school's boxes opens a small informative modal:
    > **Title:** Plazas Bloqueadas  
    > **Message:** *This school has a pending request or exchange proposal on this day. Its plazas cannot be reduced, deleted, or moved until the request is accepted, rejected, or cancelled in the Notification Center.*  
    > **Button:** `[Entendido]`
- **Admin Override:** The Admin can still edit, reduce, move, or delete locked plazas. Doing so **automatically cancels** the associated pending request.

### B. Edit Plazas Modal (When Not Locked)
- Double-clicking **ANY box** of a school opens the edit modal for that school's **TOTAL plazas that day**.
- Displays the center name, date, current total plazas for this school, and optional note.
- Calculates the maximum capacity this school can grow to:  
  `input_limit = plazas_libres + current_total` (no 12 limit).

### C. Available Actions in the Modal

#### Option 1: Reduce Plazas (`new_pax < current_total`)
- **Validation:** Always allowed (releases spots back to the day's available pool).
- **Execution:**
  - **Admin:** Applies change immediately.
  - **Center:** WhatsApp confirmation: `"[School] reduced plazas from [X] to [Y] on [Date]"` (and displays updated boxes).

#### Option 2: Increase Plazas (`new_pax > current_total`)
- **If `new_pax > input_limit`:**
  - Shows centered popup modal:
    > **Title:** Cupo Excedido  
    > **Message:** *There is only room to increase up to a maximum of Z plazas on this day (total daily quota: [dayQuota] spots).*
- **If it fits:**
  - **Admin:** Applies change immediately.
  - **Center:** WhatsApp confirmation: `"[School] increased plazas from [X] to [Y] on [Date]"`.

#### Option 3: Delete Plazas (`[Eliminar Plazas]`)
- "Eliminar" removes **all of that school's plazas for that day**.
- Opens confirmation modal:
  > **Title:** Confirmar Eliminación  
  > **Message:** *Are you sure you want to delete all [X] plazas of [Center] on [Date]? The plazas will be released back to the general quota.*  
  > **Buttons:** `[Cancelar]` | `[Eliminar Definitivamente]`
- **Admin:** Deletes the plazas record immediately.
- **Center:** Cancellation confirmation and WhatsApp dispatch.

#### Option 4 (Admin Only): Reassign Dive School
- The Admin can change the school assigned to these plazas using the dropdown.
- The plazas are **added to the destination school's total** on that day.

#### Option 5 (Dive Centers Only): Ceder Plazas (`[Ceder Plazas]`)
- Available to dive centers on their own unlocked plazas.
- Opens the **Cesión Directa** flow from Section 3.1 to voluntarily transfer plazas from this school to another school.

---

## 3. Double-Click on ANOTHER Center's Box (Request Plazas)
**Goal:** Request plazas from another school on that day.

### A. Flow
1. Does **NOT** allow editing or deleting the other school's plazas.
2. If the target school's plazas on that day are already locked by a pending request, opens the locked modal explaining they are currently pending.
3. The request is made to a **school for that day** (not to a specific box). Opens the **"Solicitar Plazas a [Center Name]" Modal**:
   - Shows that school's total plazas on that day.
   - Selector: Request between `1` and that school's total plazas, or check *"Todas las plazas"* (replaces "Barco completo").
   - **"Todas las plazas" Definition:** Means the number of plazas the target school had when the request was sent. Since the plazas can't be reduced while locked, this number is always still available at acceptance.
4. Upon confirmation:
   - Dispatches a WhatsApp notification to the target school.
   - That school's plazas for that day are locked on the visor with a `⏳` badge on all its boxes.
   - Creates a pending request in the Notification Center. The calendar is **not modified** until accepted.

### B. Acceptance Flow
- When the target school opens their Notification Center and clicks **"Aceptar"**:
  1. The giving school's total is **reduced by the requested plazas** (or **removed** if it reaches 0).
  2. The requested plazas are **ADDED to the requesting school's total that day** (if the requesting school already had plazas, they are summed into one total; if not, a record is created).
  3. The day's total occupied spots do not change, so **no quota check is needed**.
  4. **Re-check on Acceptance:** Before applying, records are re-checked in real-time. If anything no longer fits or is invalid, the request is removed with a message stating it is no longer valid.
  5. **Rejection:** If the target school clicks 'Rechazar', the request is removed, the school's plazas are unlocked, and nothing changes on the calendar.

---

## 3.1 Cesión Directa (Direct Transfer / Donation)
**Goal:** A school gives plazas to another school voluntarily without being asked.

### Flow
1. Works like an accepted request in reverse:
   - The giving school selects its own plazas on a day and chooses **"Ceder Plazas"**.
   - Selects the receiving school from the dropdown.
   - Selects the number of plazas to give (between 1 and its current total plazas, or *"Todas las plazas"*).
2. Upon confirmation:
   - A proposal is sent to the receiving school via WhatsApp and added to their Notification Center.
   - The giving school's plazas for that day are locked with a `⏳` badge on all its boxes.
3. When the receiving school confirms in their Notification Center:
   - The giving school's total is **reduced by the donated plazas** (or removed if it reaches 0).
   - The donated plazas are **ADDED to the receiving school's total that day** (increasing its total; no new record is created).
   - Since the transfer happens on the same day, the day's total quota is unchanged and **no quota check is needed**.
   - **Rejection:** If the target school clicks 'Rechazar', the request is removed, the school's plazas are unlocked, and nothing changes on the calendar.

---

## 4. Drag & Drop Plazas to ANOTHER Day
**Goal:** Move date or initiate an exchange.

### Permissions & Locking
- Dive centers cannot drag locked plazas. All boxes of a locked school on that day show `⏳` and cannot be dragged.
- Dragging **any box** of a school drags **ALL of that school's plazas for that day**.
- The admin can drag any school's plazas, including locked ones; doing so automatically cancels the associated pending request (same rule as Section 2A).

### School's Existing Plazas on the Target Day
- If the dragging school **already has plazas on the target day**:
  - Those own plazas are **never offered as swap options**.
  - They **do count** towards the target day's occupied spots.
  - On the target day, the moved plazas are **ADDED to the school's existing total there**.

---

### Scenario 4A: Target Day has NO other schools (or only free capacity)
1. **If all plazas fit (`free_spots_target >= school_plazas`):**
   - **Admin:** Moves all plazas directly to the new day (added to the school's existing total on the target day if any).
   - **Center:** WhatsApp modal: `"[School] moved plazas from [Day 1] to [Day 2] (X plazas)"`.
2. **If target day has spots but CANNOT fit all (`0 < free_spots_target < school_plazas`):**
   - Shows **Quota Limit Modal (Automatic Reduction & Split)**:
     > **Title:** Límite de Cupo — Reducción Automática  
     > **Message:** *On [Target Day], there are only [X] free spots available.<br><br>Your [Y] plazas will be split:<br>• **[X] plazas** will be added to [Target Day]<br>• **[Y - X] plazas** will remain on [Original Day]<br><br>Do you accept this automatic adjustment?*  
     > **Buttons:** `[Cancelar]` | `[Aceptar Ajuste]`
   - **If accepted (Split Plazas Rule):**
     1. **[X] plazas** are added to the school's total on the destination day.
     2. The remaining `school_plazas - free_spots_target` (**[Y - X] plazas**) stay in the school's total on the original day.
     *(Example: If Mangamar has 8 plazas and drags them to a day with 3 free spots, 3 plazas are added to Mangamar's total on the target day, and the remaining 5 plazas stay on the original day. Zero spots are lost; no new departure record is created).*
   - If cancelled: Plazas stay unchanged on the original day.
3. **If target day is 100% full (`free_spots_target <= 0`):**
   - Shows centered popup modal:
     > **Title:** Cupo Lleno  
     > **Message:** *Cannot move plazas to [Target Day] because the daily quota is completely full.*  
     > **Button:** `[Entendido]`

---

### Scenario 4B: Target Day ALREADY HAS plazas from other schools
Opens the **Action Choice Modal**:
> **Title:** Elige una Acción  
> **Subtitle:** *There are schools assigned on this day. You can occupy free space or swap dates with another school.*

#### Option 1: Button `[Ocupar Hueco Libre (X plazas available)]`
*(Only visible if `free_spots_target > 0`)*
- If all plazas fit: Moves the plazas directly (added to the school's existing total on the target day if any).
- If only partial plazas fit: Triggers the automatic reduction & split modal (Scenario 4A.2). [X] plazas are added to the destination day's total, and the remaining [Y - X] plazas remain on the original day's total.

#### Option 2: Swap Buttons `[Intercambiar con Escuela B (Y plazas)]`
- Shows **ONE button per other school** on the target date, displaying that school's total plazas: `[Intercambiar con Escuela B (Y plazas)]`.
- Locked schools on the target day are not offered as swap options (either hidden or shown disabled with the text "Solicitud pendiente").
- Clicking a button proceeds to the **Swap / Exchange Flow (Section 5)**.

---

## 5. Date Exchange between Two Dive Centers (Swap)
**Setup:** School A (Day A, $P_A$ total plazas) ↔ School B (Day B, $P_B$ total plazas).

### Bilateral Quota Calculations
- **Free space on Day B for School A:**  
  `space_B = max_quota_B - (occupied_B - P_B)`
- **Free space on Day A for School B:**  
  `space_A = max_quota_A - (occupied_A - P_A)`

---

### Cases & Validations

#### Case 1: When is a Swap Truly Impossible? (`space_A <= 0` or `space_B <= 0`)
- A swap is only completely blocked if one of the days has literally **0 available capacity** for incoming divers (`space <= 0`).
- **When can this happen?** This can only happen when a day is closed or the admin has set a quota override lower than the spots already booked on it (such as an admin quota override of 0). It cannot happen just because other schools fill the day, because the swapping school's own plazas are always freed first.
- **Behavior:**
  - Shows Centered Blocking Modal:
    > **Title:** Error de Cupo  
    > **Message:** *Cannot perform exchange: [Day] has zero available capacity to host incoming divers.*  
    > **Button:** `[Entendido]`

---

#### Case 2: Asymmetrical Split Swap (`space_A > 0` and `space_B > 0`, but `P_A > space_B` or `P_B > space_A`)
- **Bilateral Split & Retention Rule (Zero Spots Lost):**
  Whenever a school has more plazas than the target day can accommodate under the quota ceiling, the swap is **NOT blocked**. Instead, the plazas are **split**:
  - As many plazas as will safely fit move to the destination day (`safe_pax`), where they are **added to that school's total on the destination day**.
  - The remaining plazas **stay in the school's total on the original day** (`retained_pax = original_pax - safe_pax`).
  - **Formulas:**
    - Center A moves `safe_A = min(P_A, space_B)` plazas to Day B, and keeps `P_A - safe_A` plazas on Day A.
    - Center B moves `safe_B = min(P_B, space_A)` plazas to Day A, and keeps `P_B - safe_B` plazas on Day B.
  - **At most one of the two schools can ever be split.**

- **Concrete Walkthrough (Valid Split Example):**
  - **Day A** (quota 30): School A has **12 plazas**, other centers occupy 10 spots $\rightarrow$ `space_A = 30 - 10 = 20`.
  - **Day B** (quota 13): School B has **4 plazas**, other centers occupy 5 spots $\rightarrow$ `space_B = 13 - 5 = 8`.
  - **Calculations:**
    - School A moves `safe_A = min(12, 8) = 8` plazas to Day B, and keeps `12 - 8 = 4` plazas on Day A.
    - School B moves `safe_B = min(4, 20) = 4` plazas to Day A, and keeps `4 - 4 = 0` plazas on Day B.
  - **Result after acceptance:**
    - **Day A:** Other centers (10) + School B (4) + School A (4 retained) = **18 / 30 spots**.
    - **Day B:** Other centers (5) + School A (8) = **13 / 13 spots**.
    - All plazas are preserved, neither school loses spots, and reserve limits are strictly respected.

- Shows **Quota Limit Modal (Automatic Split Confirmation)**:
  > **Title:** Ajuste de Cupo en Intercambio  
  > **Message:** *Target capacity cannot fit all plazas:<br><br>• [Center A]: [safe_A] plazas move to [Day B] (remaining [P_A - safe_A] stay on [Day A])<br>• [Center B]: [safe_B] plazas move to [Day A] (remaining [P_B - safe_B] stay on [Day B])<br><br>Do you accept this split exchange?*  
  > **Buttons:** `[Cancelar]` | `[Aceptar Ajuste]`

---

#### Case 3: Complete Fit (`P_A <= space_B` and `P_B <= space_A`)
- All plazas from School A move to Day B (added to School A's total on Day B).
- All plazas from School B move to Day A (added to School B's total on Day A).
- 0 plazas retained on the original days.

---

#### Case 4: Confirmation, Notification & Locking Flow for Swaps
- **Admin:** Immediate atomic execution in Firestore in 0ms without WhatsApp.
- **Dive Centers (Notification & Acceptance Flow):**
  1. Creates a pending swap proposal in `bdf_requests` with the exact split numbers.
  2. Dispatches a WhatsApp notification to the other dive school detailing the proposal.
  3. **Neither date in the visor calendar changes** yet. Both affected schools' plazas on those days are **locked** and all their boxes show a subtle `⏳` badge.
  4. While locked, neither school's plazas on those dates can be reduced, deleted, dragged, or included in another proposal (adding plazas is still allowed, see Section 2A).
  5. The target school receives a red notification badge (`🔔`) in their header and user dropdown.
  6. **Acceptance:** Only when the target school opens their Notification Center and clicks **"Aceptar"** are both calendar dates atomically updated in Firestore and on screen (moved plazas are added to destination totals; retained plazas remain).
  7. **Re-check on Acceptance:** Before applying, space_A, space_B, safe_A and safe_B are recalculated with the current data. If any of these numbers differ from the ones in the proposal (or the swap is now blocked), the request is not applied: it is removed and the target school sees a message saying the proposal is no longer valid and must be sent again.
  8. **Rejection:** If rejected, the request is deleted, both schools' plazas are unlocked, and the calendar remains completely untouched.

---

## 6. Cancelling Requests & Notification Center Layout
- Any school that sent a request, direct transfer, or swap proposal can **cancel it from the Notification Center** while it is pending.
- The **Notification Center Modal** displays two distinct lists:
  1. **Solicitudes Recibidas (Received Requests):** Pending proposals from other schools with `[Aceptar]` and `[Rechazar]` buttons.
  2. **Solicitudes Enviadas (Sent Requests):** Pending proposals sent by your school with a `[Cancelar]` button.
- Cancelling a sent request unlocks the associated school's plazas on that day immediately and removes the proposal.

---

## 7. Summary of Popup & Dialog Types
All popups unified to the clean, centered style of **`visor-reserva`**:
1. **Form Modal:** Add Plazas (Wizard with spots and dive center).
2. **Form Modal:** Edit / Delete Plazas (Edit total spots, note, or remove).
3. **Form Modal:** Request Plazas (Request spots from another school for that day).
4. **Form Modal:** Cesión Directa (Direct spot transfer to another school).
5. **Choice Modal:** Occupy Free Space vs. Swap with another School on Target Day.
6. **Warning Modal (Amber):** Quota Limit / Automatic Reduction & Split `[Cancelar] [Aceptar Ajuste]`.
7. **Error / Blocking Modal (Red):** Cupo Lleno / Error de Cupo / Plazas Insuficientes `[Entendido]`.
8. **Locking Info Modal (Blue):** Plazas Bloqueadas por Solicitud Pendiente `[Entendido]`.
9. **WhatsApp Modal (Green):** Confirmation preview before saving cloud changes.
10. **Notification Center Modal:** Tabbed / divided list of Received Requests (`[Aceptar] [Rechazar]`) and Sent Requests (`[Cancelar]`).
