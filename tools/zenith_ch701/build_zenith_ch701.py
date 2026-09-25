"""Build the meter-scaled, rigged Zenith CH 701 inspired airframe GLB.

Game body axes are +X left, +Y up, +Z nose-forward. Geometry follows the CH 701's
recognisable square high wing, fixed leading-edge slats, boxy cabin, tricycle gear,
and large tail surfaces. This is an original stylised model, not a certified replica.
"""
import bpy, math, os, bmesh
from mathutils import Vector, Matrix

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
OUT = os.path.join(ROOT, 'public/assets/models/airframes/zenith_ch701.glb')
BLEND = os.path.join(ROOT, 'assets/aircraft/zenith-ch701/source/zenith_ch701_master.blend')
for obj in list(bpy.data.objects): bpy.data.objects.remove(obj, do_unlink=True)

def p(v): return (v[0], v[2], v[1])
def mat(name, color, metal=0, rough=.7, alpha=1):
    m=bpy.data.materials.new(name); m.diffuse_color=(*color,alpha); m.use_nodes=True
    bs=m.node_tree.nodes.get('Principled BSDF'); bs.inputs['Base Color'].default_value=(*color,alpha); bs.inputs['Metallic'].default_value=metal; bs.inputs['Roughness'].default_value=rough
    if alpha < 1: m.surface_render_method='DITHERED'; bs.inputs['Alpha'].default_value=alpha
    return m
PAINT=mat('CH701 · alpine orange',(.88,.25,.055),.12,.44)
ACCENT=mat('CH701 · graphite',(.095,.12,.13),.58,.38)
WING=mat('CH701 · ivory fabric',(.82,.78,.65),0,.9)
GLASS=mat('CH701 · blue grey glazing',(.08,.27,.34),.08,.18,.36)
RUBBER=mat('CH701 · tundra rubber',(.025,.027,.028),0,.92)
METAL=mat('CH701 · brushed alloy',(.52,.57,.56),.72,.36)
SEAT=mat('CH701 · cabin leather',(.18,.105,.055),0,.88)
PANEL=mat('CH701 · instrument panel',(.06,.08,.08),.3,.48)
PROP=mat('CH701 · propeller composite',(.12,.15,.16),.58,.34)
WHITE=mat('CH701 · safety markings',(.94,.87,.66),.04,.58)

def mesh(name, verts, faces, material, local=False):
    verts=[(v[0],v[2],v[1]) for v in verts]
    me=bpy.data.meshes.new(name); me.from_pydata(verts,[],faces); me.materials.append(material)
    ob=bpy.data.objects.new(name,me); bpy.context.collection.objects.link(ob); return ob
def cube(name, center, dims, material, bevel=.0):
    bpy.ops.mesh.primitive_cube_add(size=1,location=p(center)); ob=bpy.context.object; ob.name=name
    ob.dimensions=(dims[0],dims[2],dims[1]); bpy.ops.object.transform_apply(location=False,rotation=False,scale=True); ob.data.materials.append(material)
    if bevel: mod=ob.modifiers.new('edge radii','BEVEL'); mod.width=bevel; mod.segments=2
    return ob
def rod(name,a,b,r,material):
    a,b=Vector(p(a)),Vector(p(b)); d=b-a
    bpy.ops.mesh.primitive_cylinder_add(vertices=10,radius=r,depth=d.length,location=(a+b)/2)
    ob=bpy.context.object; ob.name=name; ob.rotation_mode='QUATERNION'; ob.rotation_quaternion=d.to_track_quat('Z','Y'); ob.data.materials.append(material); return ob
def empty(name,at):
    ob=bpy.data.objects.new(name,None); bpy.context.collection.objects.link(ob); ob.location=p(at); return ob
def parent_local(ob,pivot):
    ob.parent=pivot; ob.matrix_parent_inverse=Matrix.Identity(4); ob.location=(0,0,0)
def torus(name,center,major,minor,material):
    bpy.ops.mesh.primitive_torus_add(major_radius=major,minor_radius=minor,major_segments=24,minor_segments=10,location=p(center))
    ob=bpy.context.object; ob.name=name; ob.rotation_euler[1]=math.pi/2; ob.data.materials.append(material); return ob

# A broad, constant-chord STOL wing with squared tips and separate fixed slat profiles.
def make_wing(side):
    stations=[(0,1.66,2.05),(.65,1.66,2.06),(1.4,1.65,2.08),(2.25,1.62,2.10),(3.10,1.57,2.12),(4.115,1.48,2.14)]
    profile=[(0,.012),(.08,.045),(.24,.085),(.50,.105),(.74,.08),(.92,.038),(1,.008),(.86,-.028),(.55,-.045),(.20,-.025)]
    verts=[]
    for x,chord,y in stations:
        for f,t in profile: verts.append((side*x,y+t,1.00-chord*f))
    faces=[]; n=len(profile)
    for row in range(len(stations)-1):
        for k in range(n): faces.append((row*n+k,row*n+(k+1)%n,(row+1)*n+(k+1)%n,(row+1)*n+k))
    faces.extend([tuple(range(n-1,-1,-1)),tuple((len(stations)-1)*n+k for k in range(n))])
    ob=mesh('main_wing_left' if side>0 else 'main_wing_right',verts,faces,WING)
    # Ailerons pivot at the true rear outboard hinge line.
    x0=side*2.28; y=2.115; z=-.54
    pivot=empty('aileron_L_pivot' if side>0 else 'aileron_R_pivot',(x0,y,z))
    surf=mesh('aileron_L' if side>0 else 'aileron_R',[(0,0,0),(side*1.45,0,0),(side*1.45,-.015,-.34),(0,-.015,-.34)],[(0,1,2,3)],PAINT,local=True)
    parent_local(surf,pivot)
    for x,chord,y in stations[1:]:
        rod('wing lift strut',(side*.22,.43,-.38),(side*x*.69,y-.07,-.05),.034,ACCENT)
        rod('jury strut',(side*1.6,.68,-.35),(side*x*.69,y-.08,-.05),.022,ACCENT)
make_wing(1); make_wing(-1)
# Continuous leading-edge slat: the offset gap and long straight profile are a defining CH 701 cue.
cube('fixed leading-edge slat',(0,2.17,1.12),(8.15,.14,.18),METAL,.055)

# Short, rectangular cabin with faceted sides and large glazing under the overhead wing.
# Forward is +Z. Longitudinal station: z, half-width, cabin-bottom, cabin-top.
stations=[(2.55,.32,.46,1.48),(1.92,.48,.36,1.78),(1.05,.51,.34,1.84),(.12,.50,.32,1.72),(-.82,.45,.34,1.48),(-1.60,.31,.40,1.06),(-2.55,.18,.48,.82),(-3.10,.08,.52,.68)]
for side in (-1,1):
    for idx in range(len(stations)-1):
        z0,w0,b0,t0=stations[idx]; z1,w1,b1,t1=stations[idx+1]
        # Side panel skin, orange lower fuselage and dark window frame rails.
        mesh('cabin side skin',[(side*w0,b0,z0),(side*w0,t0,z0),(side*w1,t1,z1),(side*w1,b1,z1)],[(0,1,2,3)],PAINT)
        if idx in (1,2,3):
            mesh('panoramic cabin glazing',[(side*(w0+.012),b0+.16,z0-.05),(side*(w0+.012),t0-.10,z0-.05),(side*(w1+.012),t1-.10,z1+.05),(side*(w1+.012),b1+.16,z1+.05)],[(0,1,2,3)],GLASS)
            for frac in (.18,.82):
                z=z0+(z1-z0)*frac; w=w0+(w1-w0)*frac; bot=b0+(b1-b0)*frac; top=t0+(t1-t0)*frac
                rod('cabin window post',(side*w,bot+.13,z),(side*w,top-.08,z),.018,ACCENT)
        rod('cabin longeron',(side*w0,b0,z0),(side*w1,b1,z1),.035,ACCENT)
        rod('roof rail',(side*w0,t0,z0),(side*w1,t1,z1),.026,ACCENT)
    for z,w,b,t in stations:
        rod('cabin frame crossbar',(-w,t,z),(w,t,z),.023,ACCENT)
# Angled windshield glazing and protective roof crown.
mesh('wide forward windshield',[(-.39,.88,2.12),(.39,.88,2.12),(.47,1.68,1.91),(-.47,1.68,1.91)],[(0,1,2,3)],GLASS)
cube('cabin roof',(0,1.72,.74),(.93,.12,1.22),PAINT,.12)
cube('cargo cabin floor',(0,.43,-.42),(.78,.12,1.25),ACCENT,.03)
for x in (-.21,.21):
    cube('pilot seat cushion',(x,.67,.10),(.30,.16,.42),SEAT,.05)
    cube('pilot seat back',(x,.96,-.14),(.30,.44,.10),SEAT,.035)
cube('wide instrument panel',(0,1.13,1.50),(.78,.27,.08),PANEL,.025)
for x in (-.27,-.09,.09,.27):
    bpy.ops.mesh.primitive_cylinder_add(vertices=16,radius=.045,depth=.018,location=p((x,1.29,1.54)))
    g=bpy.context.object; g.name='round flight instrument'; g.data.materials.append(WHITE)
for x in (-.2,.2): rod('control stick',(x,.68,.68),(x,.98,.82),.025,METAL)

# Large, squared horizontal tail and tall vertical fin; control surfaces are separate pivots.
mesh('horizontal_tail',[(-1.52,.80,-2.62),(1.52,.80,-2.62),(1.42,.83,-3.25),(-1.42,.83,-3.25)],[(0,1,2,3)],WING)
piv=empty('elevator_pivot',(0,.82,-3.07)); s=mesh('elevator',[(0,0,0),(1.28,0,0),(1.28,-.015,-.31),(0,-.015,-.31)],[(0,1,2,3)],PAINT,local=True); parent_local(s,piv)
mesh('vertical_fin',[(0,.72,-2.55),(0,2.03,-2.86),(0,1.83,-3.28),(0,.79,-3.24)],[(0,1,2,3)],PAINT)
piv=empty('rudder_pivot',(0,.80,-3.08)); s=mesh('rudder',[(0,0,0),(0,1.00,0),(0,1.00,-.28),(0,0,-.28)],[(0,1,2,3)],WING,local=True); parent_local(s,piv)

# Wide gear stance, large tundra tyres, and nose mounted Rotax-style engine/tractor propeller.
for side in (-1,1):
    rod('main gear shock strut',(side*.18,.48,.20),(side*.96,-.49,-.12),.075,ACCENT)
    rod('main gear brace',(side*.52,.26,-.34),(side*.96,-.46,-.12),.05,METAL)
    pivot=empty('wheel_L_pivot' if side<0 else 'wheel_R_pivot',(side*.96,-.58,-.12))
    wheel=torus('main tundra wheel',(side*.96,-.58,-.12),.35,.12,RUBBER); wheel.parent=pivot; wheel.matrix_parent_inverse=Matrix.Identity(4); wheel.location=(0,0,0)
    rod('main axle',(side*.82,-.58,-.12),(side*1.10,-.58,-.12),.07,METAL)
rod('nose gear leg',(0,.43,1.54),(0,-.50,2.12),.06,METAL)
piv=empty('wheel_nose_pivot',(0,-.59,2.12)); wheel=torus('nose tundra wheel',(0,-.59,2.12),.25,.085,RUBBER); wheel.parent=piv; wheel.matrix_parent_inverse=Matrix.Identity(4); wheel.location=(0,0,0)
cube('angular engine cowling',(0,1.03,2.17),(.78,.74,.98),PAINT,.16)
for y in (.78,.91,1.04,1.17,1.30): cube('cooling louvre',(0,y,2.665),(.50,.025,.018),ACCENT,.006)
for x in (-.24,.24): cube('wing strut root fairing',(x,.92,.48),(.12,.17,.30),METAL,.04)
prop=empty('propeller_pivot',(0,1.02,2.72))
for i in range(3):
    a=2*math.pi*i/3; cx=math.cos(a); cy=math.sin(a)
    blade=mesh('propeller blade',[(.12*cx,.12*cy,0),(.36*cx-.09*cy,.36*cy+.09*cx,0),(.72*cx-.11*cy,.72*cy+.11*cx,0),(.88*cx,.88*cy,0),(.73*cx+.10*cy,.73*cy-.10*cx,0),(.34*cx+.08*cy,.34*cy-.08*cx,0)],[(0,1,2,3,4,5)],PROP,local=True); parent_local(blade,prop)
bpy.ops.mesh.primitive_cylinder_add(vertices=16,radius=.13,depth=.18,location=p((0,1.02,2.72)))
hub=bpy.context.object; hub.name='propeller hub'; hub.data.materials.append(METAL); hub.rotation_euler[0]=math.pi/2; hub.parent=prop; hub.matrix_parent_inverse=Matrix.Identity(4); hub.location=(0,0,0)

for ob in bpy.context.scene.objects:
    if ob.type=='MESH':
        bm=bmesh.new(); bm.from_mesh(ob.data); bmesh.ops.recalc_face_normals(bm,faces=bm.faces); bm.to_mesh(ob.data); bm.free(); ob.data.update()
os.makedirs(os.path.dirname(OUT),exist_ok=True); os.makedirs(os.path.dirname(BLEND),exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=BLEND)
bpy.ops.object.select_all(action='DESELECT')
for ob in bpy.context.scene.objects: ob.select_set(True)
bpy.context.view_layer.objects.active=bpy.context.selected_objects[0]
bpy.ops.export_scene.gltf(filepath=OUT,export_format='GLB',use_selection=True,export_apply=True,export_materials='EXPORT')
print('Wrote',OUT)
