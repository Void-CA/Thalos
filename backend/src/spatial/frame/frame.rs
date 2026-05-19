#[derive(Clone, Hash, PartialEq, Eq, Debug)]
pub enum FrameId {
    World,
    Id(u64),
}

impl FrameId {
    pub fn new(id: u64) -> Self {
        Self::Id(id)
    }
}

pub struct Frame {
    id: FrameId,
    name: String,
}

impl Frame {
    pub fn new(id: FrameId, name: String) -> Self {
        Self { id, name }
    }

    pub fn world() -> Self {
        Self {
            id: FrameId::World,
            name: "world".into(),
        }
    }

    pub fn id(&self) -> &FrameId {
        &self.id
    }
}