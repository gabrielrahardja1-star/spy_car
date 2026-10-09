# 3D car models

`sedan.glb` (Car 01) and `suv.glb` (Car 02) come from **Car Kit 3.1 by Kenney** (https://kenney.nl/assets/car-kit),
released under **CC0 1.0** (public domain). Licence text: `KENNEY-LICENSE.txt`. Crediting Kenney is optional.
`Textures/colormap.png` is the shared colour atlas from the same kit.

One change was made to the GLB files: the `KHR_texture_transform` extension (identity transform, `texCoord: 0`) was
removed from the material and from `extensionsUsed`, because luma.gl 9.4 reads its `texCoord` as a second UV set and then
draws nothing. The geometry, texture and colours are untouched.

Orientation: front is +Z, Y is up, one scene unit is about 2.2 m (see `src/components/map/carModels.ts`).
