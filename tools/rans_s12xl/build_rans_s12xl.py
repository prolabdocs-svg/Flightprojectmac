"""Build the stylized, meter-scale RANS S-12XL reference GLB.
Authoring coordinates match game body axes: +X left, +Y up, +Z forward.
Blender Y maps to glTF -Z, so the exporter basis is (X,-Z,Y) to preserve the game's +Z nose.
"""
import bpy, math, os
from mathutils import Vector
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
OUT = os.path.join(ROOT, 'assets/aircraft/rans-s12xl/models/rans_s12xl_source.glb')
BLEND = os.path.join(ROOT, 'assets/aircraft/rans-s12xl/source/rans_s12xl_master.blend')
RENDER = os.environ.get('RANS_RENDER_VIEWS') == '1'
# Scale the vertical profile about the ground-contact plane so the 89 in
# published height is respected while wing span, chord and length stay true.
Y_SCALE=2.24/3.36; Y_OFFSET=-.91*(1-Y_SCALE)
for obj in list(bpy.data.objects): bpy.data.objects.remove(obj, do_unlink=True)

def bp(p): return (p[0], -p[2], p[1]*Y_SCALE+Y_OFFSET)
def blocal(p): return (p[0], -p[2], p[1]*Y_SCALE)
def mat(name, color, metallic=0, rough=.72, alpha=1):
    m=bpy.data.materials.new(name); m.diffuse_color=(*color,alpha); m.use_nodes=True
    bs=m.node_tree.nodes.get('Principled BSDF'); bs.inputs['Base Color'].default_value=(*color,alpha); bs.inputs['Metallic'].default_value=metallic; bs.inputs['Roughness'].default_value=rough
    if alpha < 1: m.surface_render_method='DITHERED'; bs.inputs['Alpha'].default_value=alpha
    return m
FABRIC=mat('Doped fabric · warm ivory',(.77,.72,.56),rough=.9)
TUBE=mat('Graphite steel tube',(.13,.17,.18),.68,.38)
RUBBER=mat('Tire rubber',(.025,.027,.029),rough=.9)
GLASS=mat('Clear lightly tinted polycarbonate',(.24,.46,.48),.08,.22,.42)
ENGINE=mat('Rotax 582 blue head',(.07,.19,.29),.58,.42)
WOOD=mat('Two blade wood prop',(.28,.105,.035),rough=.58)
SEAT=mat('Cockpit upholstery · saddle ochre',(.38,.20,.085),rough=.86)
PANEL=mat('Instrument panel',(.08,.095,.095),.25,.45)
DIAL=mat('Instrument faces',(.025,.032,.035),.12,.32)
RIB=mat('Subtle fabric rib tape',(.66,.61,.48),rough=.9)
def mesh(name, points, faces, material, local=False):
    points=[(blocal if local else bp)(p) for p in points]
    data=bpy.data.meshes.new(name); data.from_pydata(points,[],faces); data.materials.append(material)
    obj=bpy.data.objects.new(name,data); bpy.context.collection.objects.link(obj); return obj
def cube(name, center, dims, material, bevel=0):
    center=bp(center); dims=(dims[0],dims[2],dims[1]*Y_SCALE)
    bpy.ops.mesh.primitive_cube_add(size=1, location=center); obj=bpy.context.object; obj.name=name; obj.data.name=name; obj.dimensions=dims
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True); obj.data.materials.append(material)
    if bevel: mod=obj.modifiers.new('soft edges','BEVEL'); mod.width=bevel; mod.segments=2
    return obj
def rod(name,a,b,radius,material):
    a,b=Vector(bp(a)),Vector(bp(b)); d=b-a
    bpy.ops.mesh.primitive_cylinder_add(vertices=8,radius=radius,depth=d.length,location=(a+b)/2)
    obj=bpy.context.object; obj.name=name; obj.data.name=name; obj.rotation_mode='QUATERNION'; obj.rotation_quaternion=d.to_track_quat('Z','Y'); obj.data.materials.append(material); return obj
def torus(name,center,major,minor,material):
    bpy.ops.mesh.primitive_torus_add(major_radius=major,minor_radius=minor,major_segments=24,minor_segments=10,location=(0,0,0))
    obj=bpy.context.object; obj.name=name; obj.data.name=name; obj.rotation_euler[1]=math.pi/2; obj.scale=(Y_SCALE,Y_SCALE,Y_SCALE); obj.data.materials.append(material); return obj
def empty(name,position):
    obj=bpy.data.objects.new(name,None); bpy.context.collection.objects.link(obj); obj.location=bp(position); return obj

# The S-12XL is a cabin pod on a light tubular aft fuselage, not a full-length
# conventional monocoque. Nose is +Z; the tail and pusher installation are -Z.
# The cabin pod ends behind the aft seat; the exposed cage carries the tail.
# Leaving the upper cabin volume to the glazed enclosure makes the two seats visible.
stations=[(3.25,.08,.08,.38),(2.72,.23,.22,.32),(2.05,.39,.20,.27),(1.20,.48,.20,.26),(.30,.45,.20,.25),(-.42,.34,.22,.25),(-.84,.17,.19,.32)]
verts=[]; sides=12
for z,width,height,center_y in stations:
    for i in range(sides):
        a=2*math.pi*i/sides; verts.append((width*math.cos(a),center_y+height*math.sin(a),z))
faces=[]
for j in range(len(stations)-1):
    for i in range(sides): faces.append((j*sides+i,j*sides+(i+1)%sides,(j+1)*sides+(i+1)%sides,(j+1)*sides+i))
mesh('Lower cabin pod and tapering tail fairing',verts,faces,FABRIC)

# Exposed four-longeron steel tail cage behind the cabin, with restrained X bracing.
boom=[(-.84,.14,.30),(-1.12,.12,.28),(-2.15,.10,.22),(-3.28,.075,.18)]
for xsign in (-1,1):
    for ysign in (-1,1):
        for i in range(len(boom)-1):
            z0,w0,h0=boom[i]; z1,w1,h1=boom[i+1]
            rod('Tail boom longeron',(xsign*w0,.38+ysign*h0,z0),(xsign*w1,.38+ysign*h1,z1),.018,TUBE)
for i in range(len(boom)-1):
    z0,w0,h0=boom[i]; z1,w1,h1=boom[i+1]
    for xs in (-1,1):
        rod('Tail boom diagonal', (xs*w0,.38-h0,z0),(xs*w1,.38+h1,z1),.012,TUBE)
        rod('Tail boom diagonal', (xs*w0,.38+h0,z0),(xs*w1,.38-h1,z1),.012,TUBE)
for z,w,h in boom[1:]:
    rod('Tail boom cross member',(-w,.38,z),(w,.38,z),.014,TUBE)

# Continuous, closed airfoil wing: 31 ft span and 14.1 m² area. Stations include
# real camber and gently rounded tips; this replaces the misleading triangular slabs.
profile=[(0,.006),(.16,.040),(.38,.061),(.64,.050),(.86,.027),(1,.004),(.84,-.016),(.60,-.029),(.34,-.025),(.12,-.012)]
wing_stations=[(0,1.66,2.08,0),(.85,1.64,2.11,0),(2.20,1.58,2.19,.015),(3.55,1.49,2.29,.035),(4.42,1.37,2.36,.055),(4.7244,1.18,2.39,.07)]
wing_verts=[]; ring=len(profile); WING_SCALE=14.1213/14.56092
for x,chord,height,cz in wing_stations:
    chord*=WING_SCALE
    for frac,thick in profile:
        wing_verts.append((x,height+thick,cz+chord*(.5-frac)))
wing_faces=[]
for row in range(len(wing_stations)-1):
    for j in range(ring):
        wing_faces.append((row*ring+j,row*ring+(j+1)%ring,(row+1)*ring+(j+1)%ring,(row+1)*ring+j))
wing_faces += [tuple(range(ring-1,-1,-1)),tuple((len(wing_stations)-1)*ring+j for j in range(ring))]
right=mesh('High wing fabric · right panel',wing_verts,wing_faces,FABRIC)
left=mesh('High wing fabric · left panel',[(-x,y,z) for x,y,z in wing_verts],wing_faces,FABRIC)

# Split out the XL's two long-span plain flaps and outboard ailerons. The control
# panel geometry shares the cambered section and follows the actual hinge axis.
AILERON_SPAN=(3.35,4.59); FLAP_SPAN=(.58,3.05); HINGE_FRAC=.70; TRAIL_FRAC=.90
def wing_chord_at(x): return (1.66-.48*(abs(x)/4.7244))*WING_SCALE
def wing_height_at(x): return 2.08+.31*(abs(x)/4.7244)
def wing_z_at(x, frac): return .055*(abs(x)/4.7244)+wing_chord_at(x)*(.5-frac)
def make_wing_control(label, side, span_range, material):
    a,b=span_range; pts=[]
    pivot_x=side*a; pivot_y=wing_height_at(a); pivot_z=wing_z_at(a,HINGE_FRAC)
    for x in (a,b):
        xx=side*x; cy=wing_height_at(xx); z1=wing_z_at(xx,HINGE_FRAC); z2=wing_z_at(xx,TRAIL_FRAC)
        # upper hinge lip -> upper trailing edge -> lower trailing edge -> lower hinge lip
        pts.extend([(xx-pivot_x,cy+.044-pivot_y,z1-pivot_z),
                    (xx-pivot_x,cy+.012-pivot_y,z2-pivot_z),
                    (xx-pivot_x,cy-.018-pivot_y,z2-.012-pivot_z),
                    (xx-pivot_x,cy-.027-pivot_y,z1-.012-pivot_z)])
    return mesh(label,pts,[(0,4,5,1),(1,5,6,2),(2,6,7,3)],material,local=True)
for side in (-1,1):
    for kind,span_range in [('flap',FLAP_SPAN),('aileron',AILERON_SPAN)]:
        tag=('L' if side>0 else 'R')
        pivot=empty(f'{kind}_{tag}_pivot',(side*span_range[0],wing_height_at(span_range[0]),wing_z_at(span_range[0],HINGE_FRAC)))
        panel=make_wing_control(f'{kind}_{tag}',side,span_range,FABRIC)
        # Geometry is authored relative to the hinge origin, so this child has
        # no inherited world-space offset and rotates around the true hinge.
        panel.parent=pivot; panel.matrix_parent_inverse=__import__('mathutils').Matrix.Identity(4)
        panel.name=f'{kind}_{tag}'

# Rib tapes remain subtle under the skin; struts form the recognizable braced high-wing frame.
for side in (-1,1):
    for k in range(1,10):
        x=side*(.28+k*.41); t=abs(x)/4.7244
        chord=(1.66-.48*t)*WING_SCALE; cy=2.08+.31*t; cz=.055*t
        rod('Wing rib tape',(x,cy+.052,cz+chord*.36),(x,cy-.025,cz-chord*.34),.006,RIB)
    rod('Main wing strut',(side*.24,.42,-.58),(side*2.65,2.28,-.35),.034,TUBE)
    rod('Cabane forward',(side*.28,.84,.82),(side*.72,2.02,.66),.032,TUBE)
    rod('Cabane aft',(side*.28,.83,-.60),(side*.72,2.02,-.52),.032,TUBE)

# Closed, clear two-seat enclosure: five-point cross sections form the roof and glazing.
canopy_stations=[(2.55,.22,.55), (1.92,.39,.53), (1.10,.47,.51),(.25,.43,.50),(-.42,.30,.48)]
canopy_profile=[(-1,0),(-.72,.20),(-.38,.34),(0,.39),(.38,.34),(.72,.20),(1,0)]
canopy=[]; canopy_faces=[]; n=len(canopy_profile)
for z,w,base in canopy_stations:
    for xfrac,rise in canopy_profile: canopy.append((xfrac*w,base+rise,z))
for row in range(len(canopy_stations)-1):
    for j in range(n-1):
        a=row*n+j; canopy_faces.append((a,a+1,a+n+1,a+n))
# Cap both ends and close the upper skin, making an actual continuous canopy shell.
canopy_faces += [tuple(range(n)), tuple((len(canopy_stations)-1)*n+j for j in range(n))]
mesh('Closed two-seat clear canopy',canopy,canopy_faces,GLASS)
# Side glazing is a separate, readable panel surface so the closed XL cabin remains
# legible in the hangar even with stylized low-opacity glass and an opaque lower pod.
for side,label in ((1,'left'),(-1,'right')):
    window=[(side*.455,.43,2.30),(side*.455,.43,-.25),(side*.455,.78,-.25),
            (side*.455,.84,.45),(side*.455,.88,1.25),(side*.455,.76,2.15)]
    mesh(f'{label.title()} cabin glazing',window,[(0,1,2,3,4,5)],GLASS)
for z,w,base in canopy_stations:
    # Structural hoops follow the side and roof edge; avoid a horizontal crossbar
    # through the viewing area at each station.
    pts=[(xfrac*w,base+rise,z) for xfrac,rise in canopy_profile]
    for a,b in zip(pts,pts[1:]):
        if max(a[1],b[1]) >= base+.25: rod('Canopy bow',a,b,.012,TUBE)
for idx in (0,1,5,6):
    rails=[(xfrac*w,base+rise,z) for z,w,base in canopy_stations for xfrac,rise in [canopy_profile[idx]]]
    for a,b in zip(rails,rails[1:]): rod('Canopy longitudinal frame',a,b,.012,TUBE)
for side in (-1,1):
    # Side door perimeter, with broad transparent panes between restrained tube frames.
    rod('Door sill',(side*.45,.49,1.30),(side*.36,.48,-.38),.025,TUBE)
    for z in (1.27,.40,-.35): rod('Door cross frame',(side*.45,.49,z),(side*.38,.77,z),.018,TUBE)
for x in (-.21,.21):
    cube('Side-by-side seat',(x,.58,.68),(.30,.20,.62),SEAT,.04); cube('Seat back',(x,.85,.38),(.30,.48,.09),SEAT,.025)
    rod('Seat frame',(x-.15,.48,.93),(x-.15,.92,.45),.012,TUBE); rod('Seat frame',(x+.15,.48,.93),(x+.15,.92,.45),.012,TUBE)
    rod('Shoulder harness',(x-.10,.98,.20),(x-.08,.74,.46),.012,SEAT); rod('Shoulder harness',(x+.10,.98,.20),(x+.08,.74,.46),.012,SEAT)
    rod('Lap belt',(x-.14,.72,.58),(x+.14,.72,.58),.012,SEAT)
cube('Instrument panel',(0,1.03,1.86),(.78,.20,.08),PANEL,.025)
# Twin control sticks, rudder pedals, and readable instrument faces complete the cockpit.
for x in (-.22,.22):
    rod('Control stick',(x,.14,.68),(x,.52,.91),.018,TUBE)
    rod('Control stick grip',(x-.08,.52,.91),(x+.08,.52,.91),.022,TUBE)
    rod('Rudder pedal',(x-.07,.14,1.25),(x+.07,.14,1.25),.018,TUBE)
for x,radius in [(-.27,.055),(-.14,.05),(0,.057),(.14,.05),(.27,.055)]:
    bpy.ops.mesh.primitive_cylinder_add(vertices=24,radius=radius,depth=.012*Y_SCALE,location=bp((x,1.03,1.805)))
    gauge=bpy.context.object; gauge.name='Instrument dial'; gauge.rotation_euler[0]=math.pi/2; gauge.data.materials.append(DIAL)
    rod('Gauge needle',(x,1.03,1.795),(x+.014,1.065,1.795),.004,TUBE)

# Tapered empennage carried by the exposed rear cage.
mesh('Horizontal stabilizer',[(-1.12,.28,-2.72),(1.12,.28,-2.72),(.83,.30,-3.35),(-.83,.30,-3.35)],[(0,1,2,3)],FABRIC)
mesh('Vertical fin',[(0,.22,-2.66),(0,1.15,-2.93),(0,.91,-3.30),(0,.25,-3.34)],[(0,1,2,3)],FABRIC)
p=empty('elevator_pivot',(0,.30,-3.08)); p['hinge_axis']='body X'; p['body_axis']='+Z nose, +Y up'; obj=mesh('Elevator',[(-.82,0,0),(.82,0,0),(.82,0,-.24),(-.82,0,-.24)],[(0,1,2,3)],FABRIC,local=True); obj.parent=p
p=empty('rudder_pivot',(0,.25,-3.12)); p.rotation_euler[2]=math.pi/2; p['hinge_axis']='body Y'; p['body_axis']='+Z nose, +Y up'
obj=mesh('Rudder',[(0,0,0),(0,.68,0),(0,.68,-.22),(0,0,-.22)],[(0,1,2,3)],FABRIC,local=True); obj.parent=p

# Fixed tricycle gear; wheel pivot origins coincide with axles.
for side in (-1,1):
    rod('Main gear leg',(side*.18,.35,.20),(side*.92,-.60,-.15),.055,TUBE)
    pivot=empty('wheel_L_pivot' if side<0 else 'wheel_R_pivot',(side*.92,-.62,-.15))
    wheel=torus('main_wheel',(0,0,0),.209,.081,RUBBER); wheel.parent=pivot
    # Blender primitive was created at origin; parent with transform preservation disabled.
    wheel.matrix_parent_inverse=__import__('mathutils').Matrix.Identity(4)
    wheel.location=(0,0,0)
    rod('Axle',(side*.80,-.62,-.15),(side*1.04,-.62,-.15),.045,TUBE)
rod('Nose gear',(0,.24,1.72),(0,-.66,2.12),.05,TUBE)
p=empty('wheel_nose_pivot',(0,-.68,2.12)); wheel=torus('nose_wheel',(0,0,0),.166,.064,RUBBER); wheel.parent=p; wheel.matrix_parent_inverse=__import__('mathutils').Matrix.Identity(4); wheel.location=(0,0,0)

# Rear-mounted Rotax 582 sits immediately aft of the cabin and above the aft pod.
# The installation position is inferred from the EC-DP9 side photograph and three-view;
# component arrangement is a legible 582 interpretation, not a serial-specific rebuild.
cube('Rotax 582 twin cylinder engine',(0,1.30,-.18),(.66,.62,.72),ENGINE,.08)
for x in (-.20,.20):
    cube('Blue head cylinder',(x,1.70,-.12),(.19,.22,.31),ENGINE,.025)
    for k in range(4):
        bpy.ops.mesh.primitive_cylinder_add(vertices=20,radius=.125,depth=.035*Y_SCALE,location=bp((x,1.48+k*.075,-.12)))
        fin=bpy.context.object; fin.name='Rotax cooling fin'; fin.data.materials.append(TUBE)
    rod('Spark plug lead',(x,1.83,-.12),(x,1.96,-.10),.012,SEAT)
# Twin carburetor inlets and a simplified but recognizable expansion exhaust.
for x in (-.23,.23):
    cube('Rotax carburetor',(x,1.12,.03),(.16,.17,.20),TUBE,.025)
    rod('Carburetor intake',(x,1.14,.12),(x,1.14,.34),.055,TUBE)
rod('Exhaust header left',(-.12,1.53,-.22),(-.27,1.37,-.48),.045,TUBE)
rod('Exhaust header right',(.12,1.53,-.22),(.27,1.37,-.48),.045,TUBE)
cube('Expansion exhaust chamber',(0,1.25,-.57),(.56,.25,.28),TUBE,.08)
# Side radiator is visible in common 582 installations; exact EC-DP9 layout is unverified.
cube('Cooling radiator',(0.48,1.37,-.30),(.12,.56,.62),TUBE,.025)
for i in range(9): rod('Radiator cooling core',(0.55,1.12+i*.06,-.60),(0.55,1.12+i*.06,.00),.008,ENGINE)
rod('Coolant hose',(0.42,1.62,-.12),(0.49,1.58,-.30),.024,TUBE)
rod('Coolant hose',(0.42,1.05,-.18),(0.49,1.10,-.32),.024,TUBE)
rod('Engine mount',(0,.48,.12),(0,1.20,.12),.035,TUBE); rod('Engine mount',(0,.48,-.55),(0,1.20,-.55),.035,TUBE)
for side in (-1,1): rod('Engine cage',(side*.55,.4,.18),(side*.55,1.85,-.58),.025,TUBE)
p=empty('propeller_pivot',(0,1.30,-.66))
for i in range(2):
    # The 68 in two-blade prop lies in the body X/Y plane; its shaft is longitudinal Z.
    blade=mesh('Wood propeller blade',[(0,0,0),(.36,.15,0),(.72,.11,0),(.865,.025,0),(.82,-.075,0),(.38,-.14,0)],[(0,1,2,3,4,5)],WOOD,local=True)
    blade.parent=p; blade.location=(0,0,0); blade.rotation_euler[1]=i*math.pi
bpy.ops.mesh.primitive_cylinder_add(vertices=12,radius=.11,depth=.16,location=bp((0,1.30,-.66)))
hub=bpy.context.object; hub.name='propeller_hub'; hub.rotation_euler[0]=math.pi/2; hub.data.materials.append(TUBE); hub.parent=p; hub.location=(0,0,0)

os.makedirs(os.path.dirname(OUT),exist_ok=True); os.makedirs(os.path.dirname(BLEND),exist_ok=True)
# Enforce consistent outward normals on generated hard-surface and fabric meshes.
import bmesh
for ob in bpy.context.scene.objects:
    if ob.type=='MESH':
        bm=bmesh.new(); bm.from_mesh(ob.data)
        bmesh.ops.recalc_face_normals(bm,faces=bm.faces)
        bm.to_mesh(ob.data); bm.free(); ob.data.update()
bpy.ops.wm.save_as_mainfile(filepath=BLEND)
if RENDER:
    # Neutral, orthographic review sheet rendered from the editable master.
    scene=bpy.context.scene
    scene.render.engine='BLENDER_EEVEE'; scene.render.resolution_x=1200; scene.render.resolution_y=900
    scene.render.resolution_percentage=100; scene.render.image_settings.file_format='PNG'; scene.render.film_transparent=True
    scene.world.color=(.12,.12,.12)
    scene.view_settings.view_transform='Standard'; scene.view_settings.look='Medium High Contrast'; scene.view_settings.exposure=0; scene.view_settings.gamma=1
    scene.render.film_transparent=False
    world=bpy.data.worlds.new('RANS review studio') if not bpy.data.worlds else bpy.data.worlds[0]
    scene.world=world; world.use_nodes=True; world.node_tree.nodes['Background'].inputs['Color'].default_value=(.065,.085,.105,1); world.node_tree.nodes['Background'].inputs['Strength'].default_value=.55
    def area_light(name, location, energy, size):
        data=bpy.data.lights.new(name,'AREA'); data.energy=energy; data.shape='DISK'; data.size=size
        lamp=bpy.data.objects.new(name,data); scene.collection.objects.link(lamp); lamp.location=location
        lamp.rotation_euler=(Vector((0,0,0))-lamp.location).to_track_quat('-Z','Y').to_euler()
    area_light('Key softbox',(7,9,8),1800,8); area_light('Fill softbox',(-8,4,1),1200,7); area_light('Rim softbox',(0,6,-8),2200,6)
    for area in bpy.context.screen.areas:
        if area.type=='VIEW_3D': area.spaces.active.region_3d.view_perspective='CAMERA'
    def camera_for(name, location, target, ortho):
        data=bpy.data.cameras.new(name); cam=bpy.data.objects.new(name,data); scene.collection.objects.link(cam)
        # Review views use game axes: +Z nose, +X left, +Y up. Blender's camera
        # local up is Z, so use body +Y as the up reference for stable projections.
        cam.location=location; direction=Vector(target)-cam.location; cam.rotation_euler=direction.to_track_quat('-Z','Y').to_euler()
        data.type='ORTHO'; data.ortho_scale=ortho; scene.camera=cam
    previews=os.path.join(ROOT,'assets/aircraft/rans-s12xl/previews'); os.makedirs(previews,exist_ok=True)
    views=[('front',(0,-14,0),(0,0,0),11),('rear',(0,14,0),(0,0,0),11),('left',(14,0,0),(0,0,0),11),('right',(-14,0,0),(0,0,0),11),('top',(0,0,14),(0,0,0),11),('bottom',(0,0,-14),(0,0,0),11),('three_quarter_front',(10,-9,3),(0,0,0),13),('three_quarter_rear',(-10,9,3),(0,0,0),13),('cockpit',bp((0,.70,.15)),bp((0,.86,1.75)),2.8),('engine',bp((2.0,1.65,-.2)),bp((0,1.35,-.2)),2.4)]
    if os.environ.get('RANS_RENDER_DETAIL') == '1': views=views[-2:]
    for name,loc,target,ortho in views:
        camera_for('Review camera · '+name,loc,target,ortho); scene.render.filepath=os.path.join(previews,name+'.png'); bpy.ops.render.render(write_still=True)
    bpy.ops.object.select_all(action='DESELECT')
bpy.ops.object.select_all(action='DESELECT')
for obj in bpy.context.scene.objects: obj.select_set(True)
bpy.context.view_layer.objects.active=bpy.context.selected_objects[0]
bpy.ops.export_scene.gltf(filepath=OUT,export_format='GLB',use_selection=True,export_apply=True,export_materials='EXPORT')
print('Wrote',OUT)
