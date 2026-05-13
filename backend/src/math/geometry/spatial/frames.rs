use std::marker::PhantomData;

pub struct Frame<T> {
    _marker: PhantomData<T>,
}