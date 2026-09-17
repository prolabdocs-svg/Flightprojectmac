import bpy
import math
import os
from mathutils import Vector

# PROJECT FLIGHT — authored low-poly asset kit.
# Run from Blender's Text Editor/Python Console. The script is idempotent and exports
# self-contained GLB files for the WebGL game (units: metres, +Z forward).

OUT = "/Users/sebastianpeimbert/Desktop/PROJECT FLIGHT/public/assets/models"
os.makedirs(OUT, exist_ok=True)

for item in list(bpy.data.objects):
    bpy.data.objects.remove(item, do_unlink=True)
for item in list(bpy.data.materials):
    bpy.data.materials.remove(item)

def mat(name, color, metallic=0.0, rough=0.65):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metallic
    return m

FABRIC = mat('fabric_canvas', (0.68, 0.58, 0.29), 0.0, 0.94)
TUBE = mat('painted_steel', (0.19, 0.24, 0.25), 0.72, 0.3)
ENGINE = mat('cast_engine', (0.055, 0.065, 0.07), 0.75, 0.43)
RUBBER = mat('rubber', (0.018, 0.018, 0.018), 0.0, 0.88)
WOOD = mat('weathered_wood', (0.27, 0.09, 0.035), 0.0, 0.92)
RUST = mat('rust', (0.36, 0.09, 0.024), 0.32, 0.82)
GALV = mat('galvanized', (0.42, 0.46, 0.45), 0.78, 0.47)
LEAF = mat('foliage', (0.08, 0.26, 0.085), 0.0, 0.95)
ORANGE = mat('safety_orange', (0.95, 0.22, 0.035), 0.0, 0.54)
YELLOW = mat('crane_yellow', (0.92, 0.52, 0.03), 0.54, 0.42)
WHITE = mat('marking_white', (0.82, 0.8, 0.66), 0.0, 0.76)
CANOPY = mat('smoked_canopy', (0.035, 0.11, 0.14), 0.34, 0.16)

def collection(name):
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    return c

def link(obj, c):
    for old in list(obj.users_collection): old.objects.unlink(obj)
    c.objects.link(obj)
    return obj

def cube(c, name, loc, scale, material, bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(location=loc)
    o=bpy.context.object; o.name=name; o.scale=scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod=o.modifiers.new('soft_edges','BEVEL'); mod.width=bevel; mod.segments=2
    o.data.materials.append(material); return link(o,c)

def cyl(c,name,loc,radius,depth,material,vertices=10,rot=None):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc)
    o=bpy.context.object; o.name=name
    if rot: o.rotation_euler=rot
    o.data.materials.append(material); return link(o,c)

def uv(c,name,loc,scale,material):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=6, location=loc)
    o=bpy.context.object; o.name=name; o.scale=scale; bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.data.materials.append(material); return link(o,c)

def cone(c,name,loc,r1,r2,depth,material,vertices=8):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=r1, radius2=r2, depth=depth, location=loc)
    o=bpy.context.object; o.name=name; o.data.materials.append(material); return link(o,c)

def rod(c,name,a,b,r,material):
    a,b = Vector(a), Vector(b)
    d=b-a; mid=(a+b)/2
    bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=r, depth=d.length, location=mid)
    o=bpy.context.object; o.name=name; o.data.materials.append(material)
    o.rotation_mode='QUATERNION'; o.rotation_quaternion=d.to_track_quat('Z','Y'); return link(o,c)

def export(c, filename):
    bpy.ops.object.select_all(action='DESELECT')
    for o in c.objects: o.select_set(True)
    bpy.context.view_layer.objects.active = next(iter(c.objects))
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, filename), export_format='GLB', use_selection=True, export_apply=True, export_materials='EXPORT')

# Airframe: fully modeled tube-and-fabric ultralight with animation-ready named controls.
c=collection('PF_AIRCRAFT_ULTRALIGHT')
cube(c,'fuselage_keel',(0,-0.15,0),(.35,.3,2.35),TUBE,.08)
for x in (-.42,.42):
    rod(c,'longeron', (x,0,-2.2), (x,0,2.1), .055,TUBE)
for z in (-1.9,-.8,.35,1.35):
    rod(c,'fuselage_cross',(-.42,0,z),(.42,0,z),.04,TUBE)
for x in (-.42,.42):
    rod(c,'diagonal', (x,0,-1.8), (-x,0,-.8), .035,TUBE)
    rod(c,'diagonal', (x,0,-.8), (-x,0,.35), .035,TUBE)
    rod(c,'diagonal', (x,0,.35), (-x,0,1.35), .035,TUBE)
for x in (-1,1):
    cube(c,'wing_panel_L' if x<0 else 'wing_panel_R',(x*2.65,.28,0),(2.55,.06,.72),FABRIC,.035)
    rod(c,'wing_leading',(x*.2,.28,.73),(x*5.12,.28,.73),.045,TUBE)
    rod(c,'wing_trailing',(x*.2,.28,-.73),(x*5.12,.28,-.73),.035,TUBE)
    for k in (1.25,2.5,3.75): rod(c,'wing_rib',(x*k,.25,-.70),(x*k,.25,.70),.023,TUBE)
    cube(c,'aileron_L' if x<0 else 'aileron_R',(x*4.35,.25,-.53),(.75,.055,.2),FABRIC,.02)
# High-contrast wingtips and a dark cockpit break up the large fabric silhouette at
# chase-camera distance without spending triangles on invisible detail.
for x in (-1,1):
    cube(c,'safety_tip_L' if x<0 else 'safety_tip_R',(x*5.13,.28,0),(.09,.075,.78),ORANGE,.025)
seat = cube(c,'cockpit_seat',(0,.18,-.58),(.34,.18,.42),ENGINE,.04); seat.rotation_euler=(-.32,0,0)
cube(c,'cockpit_coaming',(0,.52,-.22),(.42,.14,.56),CANOPY,.05)
for x in (-1,1): rod(c,'cockpit_rail',(x*.42,.05,-1.05),(x*.42,.72,.26),.028,TUBE)
for x in (-1,1): rod(c,'wing_brace',(x*.25,-.25,1.05),(x*4.3,.28,.2),.04,TUBE)
cube(c,'horizontal_stabilizer',(0,.45,-2.85),(1.35,.05,.42),FABRIC,.025)
cube(c,'elevator',(0,.45,-3.27),(1.35,.05,.16),FABRIC,.018)
cube(c,'vertical_stabilizer',(0,1.05,-2.9),(.04,.6,.46),FABRIC,.02)
cube(c,'rudder',(0,1.03,-3.30),(.04,.48,.16),FABRIC,.018)
cube(c,'tail_warning',(0,1.05,-3.47),(.065,.48,.045),ORANGE,.012)
cube(c,'engine_block',(0,.02,2.48),(.48,.38,.38),ENGINE,.08)
for x in (-.28,.28): cyl(c,'cylinder_head',(x,.05,2.85),.18,.32,ENGINE,10,(math.pi/2,0,0))
for y in (-.72,.72):
    bpy.ops.mesh.primitive_torus_add(major_radius=.34, minor_radius=.105, major_segments=12, minor_segments=6, location=(y,-.78,.65), rotation=(math.pi/2,0,0))
    o=bpy.context.object; o.name='main_wheel'; o.data.materials.append(RUBBER); link(o,c)
    rod(c,'gear_strut',(y,-.7,.65),(y*.42,-.1,1.1),.04,TUBE)
rod(c,'propeller_blade',(-1.12,0,3.0),(1.12,0,3.0),.06,WOOD)
cyl(c,'prop_hub',(0,0,2.97),.13,.22,ENGINE,10,(math.pi/2,0,0))
export(c,'pf_aircraft_ultralight.glb')

# The Field prop kit: barn, water tower, tree, runway markings, windsock.
c=collection('PF_FIELD_PROPS')
cube(c,'barn_body',(0,2.6,0),(5.5,2.6,4.2),WOOD,.12)
for x in (-1,1):
    # gable roof halves
    roof=cube(c,'barn_roof',(0,5.7,x*2.2),(6.1,.18,2.65),RUST,.04); roof.rotation_euler.x=x*.72
cube(c,'barn_door',(0,1.45,4.24),(1.45,1.45,.05),TUBE,.02)
cyl(c,'tower_column',(0,4.5,0),.55,9,GALV,10)
for z in (1.2,3.5,5.8):
    for sx in (-1,1): rod(c,'tower_brace',(sx*.55,z-1.8,0),(sx*.55,z,0),.025,GALV)
cyl(c,'tower_tank',(0,10.0,0),2.35,2.9,GALV,16)
cyl(c,'tree_trunk',(0,1,0),.22,2,WOOD,8)
cone(c,'tree_crown',(0,4.1,0),2.0,.35,5.5,LEAF,9)
cyl(c,'windsock_pole',(0,3,0),.075,6,WHITE,8)
cone(c,'windsock',(1.5,5.65,0),.42,.16,3,ORANGE,10); bpy.context.object.rotation_euler=(0,math.pi/2,0)
cube(c,'runway_marker',(0,.035,0),(1.5,.03,.32),WHITE,.01)
export(c,'pf_field_props.glb')

# Scrap Valley prop kit: crane, irregular metal pile, power pylon.
c=collection('PF_SCRAP_VALLEY_PROPS')
for x in (-4.5,4.5):
    rod(c,'gantry_leg',(x,0,-2.5),(x,8,-2.5),.18,YELLOW); rod(c,'gantry_leg',(x,0,2.5),(x,8,2.5),.18,YELLOW)
rod(c,'gantry_top',(-5,8,0),(5,8,0),.23,YELLOW)
rod(c,'gantry_beam',(0,8,-3),(0,8,3),.18,YELLOW)
rod(c,'gantry_hook',(0,8,0),(0,4.5,0),.04,ENGINE); cyl(c,'hook_weight',(0,4.2,0),.22,.5,ENGINE,8)
for i,(x,z,s) in enumerate(((-1,0,1.2),(1,.3,.9),(.1,1.4,.75),(-.6,-1.2,.85),(1.2,-1.1,.6))):
    box=cube(c,'scrap_bale',(x,s*.42,z),(s,s*.42,s*.65),RUST,.1); box.rotation_euler=(.12*i,.45*i,.08*i)
cyl(c,'power_pole',(0,5,0),.18,10,WOOD,8); rod(c,'crossarm',(-1.5,8.8,0),(1.5,8.8,0),.09,WOOD)
for x in (-1.2,0,1.2): cyl(c,'insulator',(x,9.15,0),.1,.42,GALV,8)
export(c,'pf_scrap_valley_props.glb')

# Shared markers/UI-world props.
c=collection('PF_MISSION_PROPS')
bpy.ops.mesh.primitive_torus_add(major_radius=4,minor_radius=.13,major_segments=32,minor_segments=6,location=(0,.15,0),rotation=(math.pi/2,0,0)); o=bpy.context.object; o.name='landing_target_ring';o.data.materials.append(ORANGE);link(o,c)
cone(c,'checkpoint_flagpole',(0,4,0),.08,.08,8,TUBE,8)
cube(c,'checkpoint_flag',(1.1,6.1,0),(1.1,.55,.025),ORANGE,.01)
export(c,'pf_mission_props.glb')

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,'project_flight_assets.blend'))
print('PROJECT FLIGHT assets exported to', OUT)
