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
SEAT = mat('seat_fabric', (0.03, 0.03, 0.03), 0.0, 0.85)
ALU = mat('aluminum_rim', (0.72, 0.73, 0.75), 0.85, 0.25)

def collection(name):
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    return c

def link(obj, c):
    for old in list(obj.users_collection): old.objects.unlink(obj)
    c.objects.link(obj)
    return obj

def cube(c, name, loc, scale, material, bevel=0.0, rot=None):
    bpy.ops.mesh.primitive_cube_add(location=loc)
    o=bpy.context.object; o.name=name; o.scale=scale
    if rot: o.rotation_euler=rot
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
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

# Airframe: weight-shift ultralight trike — tube boom, kingpost-braced sail wing,
# tricycle gear, tandem seats, pusher engine. Modeled after real trike construction
# (e.g. Quicksilver/Aviator MX-class) rather than a fixed cabin monoplane.
c=collection('PF_AIRCRAFT_ULTRALIGHT')
rod(c,'boom_longeron',(0,.15,-2.9),(0,.15,2.55),.055,TUBE)
# Wheel centers must land exactly on the strut's lower end point — the axle, not a
# nearby approximation — or the wheel visibly floats off its own axle.
NOSE_AXLE=(0,-.7,2.2)
MAIN_AXLE_Y=-.75
rod(c,'nose_strut',(0,.15,2.35),NOSE_AXLE,.04,TUBE)
def wheel(name,loc,major=.34):
    # Torus normal must point along X (axle sideways) so the wheel stands as a vertical
    # disc facing forward — rotating around X instead lays it flat like a life-ring.
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=.11, major_segments=14, minor_segments=7, location=loc, rotation=(0,math.pi/2,0))
    o=bpy.context.object; o.name=name; o.data.materials.append(RUBBER); link(o,c)
    cyl(c,name+'_hub',loc,major*.4,.05,ALU,10,(0,math.pi/2,0))
wheel('nose_wheel',NOSE_AXLE,.3)
for x in (-.95,.95):
    axle=(x,MAIN_AXLE_Y,.35)
    rod(c,'main_strut',(0,.15,.35),axle,.045,TUBE)
    wheel('main_wheel',axle)
# Tandem seats: pilot forward, passenger aft, spaced so the seat blocks (0.64m deep each)
# don't overlap into a single fused shape.
for i,z in enumerate((1.35,.15)):
    seat=cube(c,f'cockpit_seat_{i}',(0,.42,z),(.32,.22,.32),SEAT,.05)
    back=cube(c,f'cockpit_seat_back_{i}',(0,.68,z-.22),(.32,.32,.06),SEAT,.03); back.rotation_euler=(-.35,0,0)
    # 2-point lap belt across each seat, called out explicitly on the reference sheet.
    belt=cube(c,f'seat_belt_{i}',(0,.5,z+.02),(.34,.02,.06),ORANGE,.01); belt.rotation_euler=(-.5,0,0)
# A real Quicksilver MX-class is 3-axis (stick + pedals + ailerons), not weight-shift —
# the kingpost/cable bracing is authentic to the type, but control linkages were missing.
rod(c,'control_stick',(0,.35,1.2),(0,.85,1.05),.018,TUBE)
rod(c,'rudder_pedal_bar',(-.22,.05,2.05),(.22,.05,2.05),.02,TUBE)
uv(c,'asi_gauge',(.16,.6,1.3),(.05,.05,.05),WHITE)
rod(c,'kingpost_strut',(0,.15,.75),(0,1.6,.75),.045,TUBE)
sweep=0.30
for x in (-1,1):
    cube(c,'wing_panel_L' if x<0 else 'wing_panel_R',(x*2.75,1.62,.55),(2.7,.045,.95),FABRIC,.03,rot=(0,-sweep*x,0))
    cube(c,'safety_tip_L' if x<0 else 'safety_tip_R',(x*5.35,1.62,-.15),(.08,.08,.9),ORANGE,.02,rot=(0,-sweep*x,0))
    rod(c,'wing_leading',(x*.15,1.62,1.42),(x*5.4,1.62,.1),.045,TUBE)
    rod(c,'wing_trailing',(x*.15,1.62,-.35),(x*5.05,1.62,-.75),.035,TUBE)
    # Rib battens showing through the sail — the scalloped structure line real Quicksilver
    # wings read by at close range — plus a hinged outboard aileron for genuine 3-axis roll.
    for k in (1.4,2.35,3.3,4.25):
        rod(c,'wing_rib',(x*k,1.615,-.32),(x*k,1.615,1.15),.018,TUBE)
    aileron=cube(c,'aileron_L' if x<0 else 'aileron_R',(x*4.55,1.6,-.62),(.62,.035,.16),FABRIC,.015,rot=(0,-sweep*x,0))
# Cable fan: kingpost + boom flying/landing wires bracing the wing, plus fore/aft stays —
# this is the defining silhouette of a cable-braced trike wing and was entirely absent before.
kp_top=(0,1.6,.75)
boom_nose=(0,.16,2.3); boom_seat_rear=(0,.16,.1); boom_tail=(0,.16,-1.6)
for x in (-1,1):
    tip=(x*5.35,1.62,-.15); inner=(x*1.2,1.55,1.1)
    rod(c,'flying_wire',kp_top,tip,.01,TUBE)
    rod(c,'flying_wire',boom_nose,tip,.01,TUBE)
    rod(c,'landing_wire',boom_seat_rear,tip,.01,TUBE)
    rod(c,'landing_wire',boom_tail,tip,.01,TUBE)
    rod(c,'root_brace',kp_top,inner,.012,TUBE)
rod(c,'fore_brace',boom_nose,kp_top,.014,TUBE)
rod(c,'aft_brace',boom_seat_rear,kp_top,.014,TUBE)
# Solid jury struts from the lower boom to the underside of each wing panel — a real
# strut-braced high wing carries both these load tubes AND the cable bracing above,
# not cables alone.
for x in (-1,1):
    rod(c,'wing_strut',(x*.5,.15,.95),(x*2.3,1.5,.4),.035,TUBE)
# Fuel tank ahead of the front seat (which now runs to z=1.67), gravity-fed to the
# pusher engine — kept clear of the seat back instead of overlapping it.
cyl(c,'fuel_tank',(0,.42,2.0),.16,.4,GALV,10,(math.pi/2,0,0))
rod(c,'fuel_line',(0,.28,1.8),(0,.2,1.0),.018,RUBBER)
# Pusher engine behind the rear seat with a two-blade wood prop.
cube(c,'engine_block',(0,.55,-.35),(.32,.3,.34),ENGINE,.06)
for x in (-.16,.16): cyl(c,'cylinder_head',(x,.75,-.35),.11,.24,ENGINE,10,(math.pi/2,0,0))
cyl(c,'prop_hub',(0,.55,-.68),.1,.16,ENGINE,10,(math.pi/2,0,0))
rod(c,'exhaust_pipe',(.16,.42,-.2),(.24,.3,-.55),.03,ENGINE)
for x in (-1,1):
    blade=cube(c,'propeller_blade',(x*.5,.55,-.68),(.48,.015,.1),WOOD,.012)
    blade.rotation_euler=(0,0,math.radians(8*x))
# Boom-mounted tail — horizontal/vertical stabilizer, elevator, rudder.
cube(c,'horizontal_stabilizer',(0,.3,-2.75),(1.1,.04,.36),FABRIC,.02)
cube(c,'elevator',(0,.3,-3.1),(1.1,.04,.14),FABRIC,.015)
cube(c,'vertical_stabilizer',(0,.75,-2.8),(.035,.5,.4),FABRIC,.02)
cube(c,'rudder',(0,.75,-3.15),(.035,.4,.14),FABRIC,.015)
cube(c,'tail_warning',(0,.75,-3.3),(.06,.42,.045),ORANGE,.012)
rod(c,'tail_brace',(0,.16,-2.4),(0,.55,-2.8),.02,TUBE)
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
